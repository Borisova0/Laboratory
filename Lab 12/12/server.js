const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 3000;
const HOST = '127.0.0.1';

// 2 минуты для проверки истечения сессии
const SESSION_TTL_MS = 2 * 60 * 1000;

// Тестовые аккаунты с хешами паролей
const users = {
  student: {
    salt: 'c8a13e0b56f9d427a516c0bf2e93d147',
    hash: 'f8cf47afe8c0abb9f27d082dd9f81ff4b02dfe783126f7e679c22be2b5963cd2f4cc776cc6a15acf14c712437fd09fab4deea82650d5769bef8438eee9f54541'
  },

  member: {
    salt: '7b19e53f6ad42c0e918f3a6d254b87ce',
    hash: 'ca8947c05aec715c4f410532c29ecd3be158516d6431918e7176fb80cfb3e35997e6357ee4b25cc254069b04ac2c525575a7f90dc956b8c712fe7e496fbabe32'
  }
};

const sessions = new Map();

let nextPostId = 3;

const posts = [
  {
    id: 1,
    author: 'demo',
    text: 'Добро пожаловать в MiniForum! Здесь можно делиться идеями.',
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    author: 'demo',
    text: 'Гости могут читать сообщения, а публикации доступны после входа.',
    createdAt: new Date().toISOString()
  }
];

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(data));
}

function getSession(req) {
  const cookies = (req.headers.cookie || '')
    .split(';')
    .map(c => c.trim());

  const entry = cookies.find(c => c.startsWith('sid='));

  if (!entry) return null;

  const id = entry.slice(4);
  const session = sessions.get(id);

  if (!session) return null;

  if (Date.now() >= session.expiresAt) {
    sessions.delete(id);
    return null;
  }

  return { id, ...session };
}

function setSessionCookie(res, req, id, ageSeconds) {
  const secure = req.socket.encrypted ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `sid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ageSeconds}${secure}`
  );
}

function checkPassword(password, account) {
  if (!account) return false;

  const supplied = crypto.scryptSync(
    password,
    account.salt,
    64
  );

  const stored = Buffer.from(account.hash, 'hex');

  return crypto.timingSafeEqual(supplied, stored);
}

async function readBody(req) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk.toString();

    if (raw.length > 10000) {
      const error = new Error('Слишком большой запрос');
      error.status = 413;
      throw error;
    }
  }

  try {
    const data = JSON.parse(raw);

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw new Error();
    }

    return data;
  } catch {
    const error = new Error('Некорректный JSON');
    error.status = 400;
    throw error;
  }
}

async function serveFile(res, filename, mime) {
  try {
    const data = await fs.readFile(
      path.join(__dirname, filename)
    );

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(data);
  } catch {
    send(res, 404, {
      error: 'Файл не найден'
    });
  }
}

async function handler(req, res) {
  const pathname = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  ).pathname;

  // Запрет изменяющих запросов с других сайтов
  if (req.method === 'POST' || req.method === 'DELETE') {
    const origin = req.headers.origin;

    if (
      origin &&
      origin !== `http://${req.headers.host}` &&
      origin !== `https://${req.headers.host}`
    ) {
      return send(res, 403, {
        error: 'Запрос с другого сайта запрещён'
      });
    }
  }

  // Открытый просмотр публикаций
  if (req.method === 'GET' && pathname === '/api/posts') {
    return send(res, 200, {
      posts: [...posts].reverse()
    });
  }

  // Вход
  if (req.method === 'POST' && pathname === '/api/login') {
    const { username, password } = await readBody(req);

    if (
      typeof username !== 'string' ||
      !username.trim() ||
      typeof password !== 'string' ||
      !password
    ) {
      return send(res, 400, {
        error: 'Заполни логин и пароль'
      });
    }

    const name = username.trim();

    if (!checkPassword(password, users[name])) {
      return send(res, 401, {
        error: 'Неверный логин или пароль'
      });
    }

    const previous = getSession(req);

    if (previous) {
      sessions.delete(previous.id);
    }

    const id = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;

    sessions.set(id, {
      username: name,
      expiresAt
    });

    setSessionCookie(
      res,
      req,
      id,
      Math.ceil(SESSION_TTL_MS / 1000)
    );

    return send(res, 200, {
      user: { username: name },
      expiresAt
    });
  }

  // Защищённый профиль
  if (req.method === 'GET' && pathname === '/api/profile') {
    const session = getSession(req);

    if (!session) {
      return send(res, 401, {
        error: 'Нужно войти в аккаунт'
      });
    }

    return send(res, 200, {
      user: { username: session.username },
      expiresAt: session.expiresAt
    });
  }

  // Выход
  if (req.method === 'POST' && pathname === '/api/logout') {
    const session = getSession(req);

    if (session) {
      sessions.delete(session.id);
    }

    setSessionCookie(res, req, '', 0);

    return send(res, 200, {
      message: 'Выход выполнен'
    });
  }

  // Публикация сообщения
  if (req.method === 'POST' && pathname === '/api/posts') {
    const session = getSession(req);

    if (!session) {
      return send(res, 401, {
        error: 'Сначала войди в аккаунт'
      });
    }

    const { text } = await readBody(req);

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.trim().length > 500
    ) {
      return send(res, 400, {
        error: 'Текст должен содержать от 1 до 500 символов'
      });
    }

    const post = {
      id: nextPostId++,
      author: session.username,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };

    posts.push(post);

    return send(res, 201, { post });
  }

  // Удаление только своей публикации
  const match = pathname.match(/^\/api\/posts\/(\d+)$/);

  if (req.method === 'DELETE' && match) {
    const session = getSession(req);

    if (!session) {
      return send(res, 401, {
        error: 'Сначала войди в аккаунт'
      });
    }

    const index = posts.findIndex(
      post => post.id === Number(match[1])
    );

    if (index < 0) {
      return send(res, 404, {
        error: 'Публикация не найдена'
      });
    }

    if (posts[index].author !== session.username) {
      return send(res, 403, {
        error: 'Нельзя удалить чужую публикацию'
      });
    }

    posts.splice(index, 1);

    return send(res, 200, {
      message: 'Публикация удалена'
    });
  }

  // Файлы сайта
  const publicFiles = {
    '/': [
      'index.html',
      'text/html; charset=utf-8'
    ],
    '/index.html': [
      'index.html',
      'text/html; charset=utf-8'
    ],
    '/style.css': [
      'style.css',
      'text/css; charset=utf-8'
    ],
    '/script.js': [
      'script.js',
      'application/javascript; charset=utf-8'
    ]
  };

  if (
    req.method === 'GET' &&
    publicFiles[pathname]
  ) {
    return serveFile(
      res,
      ...publicFiles[pathname]
    );
  }

  if (
    req.method === 'GET' &&
    pathname === '/favicon.ico'
  ) {
    res.writeHead(204);
    return res.end();
  }

  return send(res, 404, {
    error: 'Адрес не найден'
  });
}

http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch(error => {
    if (!res.headersSent) {
      send(res, error.status || 500, {
        error: error.status
          ? error.message
          : 'Ошибка сервера'
      });
    } else {
      res.end();
    }
  });
}).listen(PORT, HOST, () => {
  console.log(
    `MiniForum запущен: http://${HOST}:${PORT}`
  );
});
