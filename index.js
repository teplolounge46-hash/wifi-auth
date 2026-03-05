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
