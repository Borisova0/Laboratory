const el = (id) => document.getElementById(id);

let currentUser = null;
let sessionEndsAt = 0;
let timerId = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || 'Ошибка запроса');
    error.status = response.status;
    throw error;
  }

  return data;
}

function message(id, text = '', kind = '') {
  const element = el(id);
  element.textContent = text;
  element.className = `message ${kind}`;
}

function showGuest() {
  currentUser = null;
  sessionEndsAt = 0;
  clearInterval(timerId);
  timerId = null;

  el('guestPanel').hidden = false;
  el('userPanel').hidden = true;
  el('composer').hidden = true;
  el('guestNotice').hidden = false;
  el('authState').textContent = 'Гостевой режим';
  el('password').value = '';
}

function updateTimer() {
  const seconds = Math.max(
    0,
    Math.ceil((sessionEndsAt - Date.now()) / 1000)
  );

  const minutes = String(
    Math.floor(seconds / 60)
  ).padStart(2, '0');

  const rest = String(
    seconds % 60
  ).padStart(2, '0');

  el('sessionTimer').textContent = `${minutes}:${rest}`;

  if (seconds === 0) {
    showGuest();
    message(
      'loginMessage',
      'Время сессии истекло. Войди снова.',
      'error'
    );
    loadPosts();
  }
}

function showUser(user, expiresAt) {
  currentUser = user;
  sessionEndsAt = expiresAt;

  el('guestPanel').hidden = true;
  el('userPanel').hidden = false;
  el('composer').hidden = false;
  el('guestNotice').hidden = true;

  el('authState').textContent = `В сети: ${user.username}`;
  el('profileName').textContent = `Аккаунт: ${user.username}`;

  clearInterval(timerId);
  updateTimer();

  if (currentUser) {
    timerId = setInterval(updateTimer, 1000);
  }
}

async function loadPosts() {
  try {
    const data = await api('/api/posts');
    const list = el('postsList');
    list.replaceChildren();

    if (data.posts.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Пока нет сообщений. Напиши первое!';
      list.append(p);
      return;
    }

    for (const post of data.posts) {
      const article = document.createElement('article');
      article.className = 'post-card';

      const top = document.createElement('div');
      top.className = 'post-top';

      const info = document.createElement('div');

      const author = document.createElement('div');
      author.className = 'post-author';
      author.textContent = `✳ ${post.author}`;

      const date = document.createElement('div');
      date.className = 'post-date';
      date.textContent = new Date(
        post.createdAt
      ).toLocaleString('ru-RU');

      info.append(author, date);
      top.append(info);

      if (currentUser) {
  const isOwner = currentUser.username === post.author;
      
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'delete-btn';
        button.textContent = isOwner ? 'Удалить' : 'Проверить доступ';

        button.addEventListener('click', () => {
          deletePost(post.id);
        });

        top.append(button);
      }

      const body = document.createElement('p');
      body.className = 'post-text';

      // Безопасное отображение текста пользователя
      body.textContent = post.text;

      article.append(top, body);
      list.append(article);
    }
  } catch (error) {
    message('forumMessage', error.message, 'error');
  }
}

async function deletePost(id) {
  try {
    await api(`/api/posts/${id}`, {
      method: 'DELETE'
    });

    message(
      'forumMessage',
      'Публикация удалена.',
      'success'
    );

    await loadPosts();
  } catch (error) {
    if (error.status === 401) {
      showGuest();
    }

    message('forumMessage', error.message, 'error');
  }
}

el('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = el('username').value.trim();
  const password = el('password').value;

  if (!username || !password) {
    message(
      'loginMessage',
      'Заполни оба поля.',
      'error'
    );
    return;
  }

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    showUser(data.user, data.expiresAt);

    message(
      'loginMessage',
      'Вход выполнен успешно!',
      'success'
    );

    message('forumMessage');
    await loadPosts();
  } catch (error) {
    message('loginMessage', error.message, 'error');
  }
});

el('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/logout', {
      method: 'POST'
    });

    showGuest();

    message(
      'loginMessage',
      'Ты вышла из аккаунта.',
      'success'
    );

    message('forumMessage');
    await loadPosts();
  } catch (error) {
    message('loginMessage', error.message, 'error');
  }
});

el('postText').addEventListener('input', () => {
  el('charCounter').textContent =
    `${el('postText').value.length} / 500`;
});

el('postForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = el('postText').value.trim();

  if (!text) {
    message(
      'forumMessage',
      'Напиши текст публикации.',
      'error'
    );
    return;
  }

  try {
    await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ text })
    });

    el('postText').value = '';
    el('charCounter').textContent = '0 / 500';

    message(
      'forumMessage',
      'Сообщение опубликовано!',
      'success'
    );

    await loadPosts();
  } catch (error) {
    if (error.status === 401) {
      showGuest();
    }

    message('forumMessage', error.message, 'error');
  }
});

el('refreshButton').addEventListener('click', () => {
  loadPosts();
});

async function init() {
  try {
    const data = await api('/api/profile');
    showUser(data.user, data.expiresAt);
  } catch (error) {
    showGuest();

    if (error.status !== 401) {
      message('loginMessage', error.message, 'error');
    }
  }

  await loadPosts();
}

init();
