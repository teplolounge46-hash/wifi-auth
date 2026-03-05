const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const RouterOSClient = require('routeros-client').RouterOSClient;
const Database = require('better-sqlite3');

// Настройки из переменных окружения Railway
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MIKROTIK_HOST = process.env.MIKROTIK_HOST;
const MIKROTIK_USER = process.env.MIKROTIK_USER;
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD;
const PORT = process.env.PORT || 3000;

// Инициализация
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
const db = new Database('users.db');

// Создаём таблицу пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    phone TEXT,
    mac_address TEXT,
    username TEXT UNIQUE,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Функция создания пользователя в MikroTik
async function createMikrotikUser(username, mac) {
  const client = new RouterOSClient({
    host: MIKROTIK_HOST,
    user: MIKROTIK_USER,
    password: MIKROTIK_PASSWORD,
    port: 8728,
    timeout: 10000
  });
  
  try {
    await client.connect();
    console.log('Connected to MikroTik');
    
    // Проверяем существует ли пользователь
    const existing = await client.write('/ip/hotspot/user/print', [`?name=${username}`]);
    
    if (existing.length > 0) {
      // Обновляем существующего
      await client.write('/ip/hotspot/user/set', [
        `=.id=${existing[0]['.id']}`,
        '=profile=3h-profile',
        `=mac-address=${mac}`,
        '=disabled=no'
      ]);
    } else {
      // Создаём нового
      await client.write('/ip/hotspot/user/add', [
        `=name=${username}`,
        `=password=${Math.random().toString(36).substring(2, 15)}`,
        '=profile=3h-profile',
        `=mac-address=${mac}`,
        '=disabled=no'
      ]);
    }
    
    await client.close();
    console.log(`User ${username} created/updated`);
    return true;
  } catch (error) {
    console.error('MikroTik error:', error);
    await client.close();
    return false;
  }
}

// Веб-сервер для портала авторизации
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('WiFi Auth Bot is running! ✅');
});

app.get('/auth', (req, res) => {
  const { mac, ip } = req.query;
  
  // Кодируем данные для передачи в бот
  const authData = Buffer.from(JSON.stringify({ mac, ip })).toString('base64');
  
  // ВАЖНО: замените на username вашего бота!
  const botUsername = 'teplo_wifi_bot'; // ⚠️ ЗАМЕНИТЕ НА СВОЙ!
  const telegramUrl = `https://t.me/${botUsername}?start=${authData}`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WiFi Авторизация</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 50px 40px;
          border-radius: 25px;
          text-align: center;
          max-width: 450px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .icon {
          font-size: 80px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 15px;
        }
        p {
          color: #666;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 30px;
        }
        .telegram-btn {
          display: inline-block;
          background: #0088cc;
          color: white;
          padding: 18px 50px;
          border-radius: 30px;
          text-decoration: none;
          font-weight: bold;
          font-size: 18px;
          transition: all 0.3s ease;
          box-shadow: 0 5px 15px rgba(0,136,204,0.3);
        }
        .telegram-btn:hover {
          background: #006699;
          transform: translateY(-3px);
          box-shadow: 0 10px 25px rgba(0,136,204,0.4);
        }
        .info {
          margin-top: 25px;
          padding-top: 25px;
          border-top: 1px solid #eee;
          font-size: 13px;
          color: #999;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">📱</div>
        <h1>Добро пожаловать!</h1>
        <p>Для получения доступа к WiFi нажмите кнопку ниже и авторизуйтесь через Telegram</p>
        <a href="${telegramUrl}" class="telegram-btn">🚀 Войти через Telegram</a>
        <div class="info">
          ⏱ Доступ предоставляется на 3 часа<br>
          📶 MAC: ${mac}<br>
          🌐 IP: ${ip}
        </div>
      </div>
    </body>
    </html>
  `);
});

// Обработчик команды /start в боте
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const startParam = match[1].trim();

  if (startParam) {
    // Есть параметр авторизации
    try {
      const authData = JSON.parse(Buffer.from(startParam, 'base64').toString());
      const { mac, ip } = authData;
      
      console.log(`Auth request from ${telegramId}, MAC: ${mac}, IP: ${ip}`);
      
      // Запрашиваем номер телефона
      bot.sendMessage(chatId, 
        '👋 Привет!\n\n' +
        'Для получения доступа к WiFi, пожалуйста, поделитесь своим номером телефона',
        {
          reply_markup: {
            keyboard: [
              [{
                text: '📱 Отправить номер телефона',
                request_contact: true
              }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        }
      );

      // Ждём номер телефона
      bot.once('contact', async (contactMsg) => {
        if (contactMsg.chat.id === chatId) {
          const phone = contactMsg.contact.phone_number;
          const username = `tg_${telegramId}`;
          
          console.log(`Phone received: ${phone}`);
          
          // Создаём пользователя в MikroTik
          const success = await createMikrotikUser(username, mac);
          
          if (success) {
            // Сохраняем в базу данных
            db.prepare(`
              INSERT OR REPLACE INTO users (telegram_id, phone, mac_address, username, expires_at)
              VALUES (?, ?, ?, ?, datetime('now', '+3 hours'))
            `).run(telegramId, phone, mac, username);
            
            bot.sendMessage(chatId, 
              '✅ *Авторизация успешна!*\n\n' +
              '🌐 Вы получили доступ к интернету\n' +
              '⏱ Время доступа: *3 часа*\n' +
              `📱 Телефон: ${phone}\n\n` +
              'Приятного пользования! 🎉',
              {
                parse_mode: 'Markdown',
                reply_markup: { remove_keyboard: true }
              }
            );
          } else {
            bot.sendMessage(chatId, 
              '❌ Ошибка при создании доступа.\n\n' +
              'Попробуйте позже или обратитесь к администратору.',
              { reply_markup: { remove_keyboard: true } }
            );
          }
        }
      });
      
    } catch (error) {
      console.error('Error processing auth:', error);
      bot.sendMessage(chatId, '❌ Ошибка обработки данных авторизации');
    }
  } else {
    // Обычный старт без параметров
    bot.sendMessage(chatId, 
      '👋 Привет!\n\n' +
      'Я бот для авторизации в WiFi сети.\n\n' +
      '📶 Подключитесь к WiFi и следуйте инструкциям на странице авторизации.\n\n' +
      'Команды:\n' +
      '/status - проверить статус доступа'
    );
  }
});

// Команда /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  
  if (user && user.expires_at) {
    const expiresAt = new Date(user.expires_at);
    const now = new Date();
    
    if (expiresAt > now) {
      const timeLeftMin = Math.round((expiresAt - now) / 1000 / 60);
      const hours = Math.floor(timeLeftMin / 60);
      const minutes = timeLeftMin % 60;
      
      bot.sendMessage(chatId, 
        '✅ *Ваша сессия активна*\n\n' +
        `⏱ Осталось времени: ${hours}ч ${minutes}мин\n` +
        `📱 Телефон: ${user.phone}\n` +
        `🔗 MAC: ${user.mac_address}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(chatId, 
        '❌ *Ваша сессия истекла*\n\n' +
        'Пожалуйста, авторизуйтесь заново через портал WiFi',
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    bot.sendMessage(chatId, 
      '📶 У вас нет активных сессий\n\n' +
      'Подключитесь к WiFi и пройдите авторизацию через портал'
    );
  }
});

// Периодическая очистка истёкших сессий (каждые 10 минут)
setInterval(async () => {
  const expired = db.prepare(`
    SELECT * FROM users WHERE expires_at < datetime('now')
  `).all();
  
  for (const user of expired) {
    console.log(`Removing expired user: ${user.username}`);
    // Здесь можно удалить пользователя из MikroTik если нужно
  }
}, 10 * 60 * 1000);

// Запуск Express сервера
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Bot started successfully!`);
});

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  bot.stopPolling();
  process.exit(0);
});
```

⚠️ **В строке 72 замените `your_wifi_bot` на username вашего бота!**

Сохраните как `index.js` в папке `C:\wifi-bot\`

### Файл 3: `.gitignore`
```
node_modules/
*.db
.env
*.log
```

Сохраните как `.gitignore` в папке `C:\wifi-bot\`

✅ **Файлы созданы!**

---

## ШАГ 3: Загрузка на GitHub

**3.1** Зайдите на https://github.com (зарегистрируйтесь если нет аккаунта)

**3.2** Нажмите зелёную кнопку **"New"** (или "New repository")

**3.3** Заполните:
- Repository name: `wifi-auth`
- Public/Private: выберите Public
- Нажмите **"Create repository"**

**3.4** На странице нового репозитория найдите ссылку **"uploading an existing file"** и нажмите

**3.5** Перетащите **3 файла** (`package.json`, `index.js`, `.gitignore`) в окно браузера

**3.6** Нажмите **"Commit changes"** (зелёная кнопка внизу)

✅ **Код на GitHub!**

---

## ШАГ 4: Деплой на Railway

**4.1** Зайдите на https://railway.app

**4.2** Нажмите **"Login"** → выберите **"Login with GitHub"**

**4.3** Нажмите **"New Project"**

**4.4** Выберите **"Deploy from GitHub repo"**

**4.5** Выберите репозиторий **"wifi-auth"**

**4.6** Railway автоматически начнёт деплой (подождите 1-2 минуты)

**4.7** Когда деплой завершится, нажмите на ваш проект → вкладка **"Variables"**

**4.8** Добавьте переменные (нажимайте **"New Variable"** для каждой):
```
TELEGRAM_BOT_TOKEN
Значение: 1234567890:ABCdefGHI... (токен из Шага 1)

MIKROTIK_HOST
Значение: 192.168.88.1 (IP вашего MikroTik)

MIKROTIK_USER
Значение: api_bot

MIKROTIK_PASSWORD
Значение: ваш_пароль (который создадите в MikroTik)const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const RouterOSClient = require('routeros-client').RouterOSClient;
const Database = require('better-sqlite3');

// Настройки из переменных окружения Railway
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MIKROTIK_HOST = process.env.MIKROTIK_HOST;
const MIKROTIK_USER = process.env.MIKROTIK_USER;
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD;
const PORT = process.env.PORT || 3000;

// Инициализация
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
const db = new Database('users.db');

// Создаём таблицу пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    phone TEXT,
    mac_address TEXT,
    username TEXT UNIQUE,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Функция создания пользователя в MikroTik
async function createMikrotikUser(username, mac) {
  const client = new RouterOSClient({
    host: MIKROTIK_HOST,
    user: MIKROTIK_USER,
    password: MIKROTIK_PASSWORD,
    port: 8728,
    timeout: 10000
  });
  
  try {
    await client.connect();
    console.log('Connected to MikroTik');
    
    // Проверяем существует ли пользователь
    const existing = await client.write('/ip/hotspot/user/print', [`?name=${username}`]);
    
    if (existing.length > 0) {
      // Обновляем существующего
      await client.write('/ip/hotspot/user/set', [
        `=.id=${existing[0]['.id']}`,
        '=profile=3h-profile',
        `=mac-address=${mac}`,
        '=disabled=no'
      ]);
    } else {
      // Создаём нового
      await client.write('/ip/hotspot/user/add', [
        `=name=${username}`,
        `=password=${Math.random().toString(36).substring(2, 15)}`,
        '=profile=3h-profile',
        `=mac-address=${mac}`,
        '=disabled=no'
      ]);
    }
    
    await client.close();
    console.log(`User ${username} created/updated`);
    return true;
  } catch (error) {
    console.error('MikroTik error:', error);
    await client.close();
    return false;
  }
}

// Веб-сервер для портала авторизации
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('WiFi Auth Bot is running! ✅');
});

app.get('/auth', (req, res) => {
  const { mac, ip } = req.query;
  
  // Кодируем данные для передачи в бот
  const authData = Buffer.from(JSON.stringify({ mac, ip })).toString('base64');
  
  // ВАЖНО: замените на username вашего бота!
  const botUsername = 'your_wifi_bot'; // ⚠️ ЗАМЕНИТЕ НА СВОЙ!
  const telegramUrl = `https://t.me/${botUsername}?start=${authData}`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WiFi Авторизация</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 50px 40px;
          border-radius: 25px;
          text-align: center;
          max-width: 450px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .icon {
          font-size: 80px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 15px;
        }
        p {
          color: #666;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 30px;
        }
        .telegram-btn {
          display: inline-block;
          background: #0088cc;
          color: white;
          padding: 18px 50px;
          border-radius: 30
