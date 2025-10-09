import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

// Verify Telegram WebApp initData
export function verifyInitData(initData) {
  const devBypass = String(process.env.DEV_ALLOW_UNSAFE || 'false').toLowerCase() === 'true';
  if (devBypass && !initData) {
    return { ok: true, user: { id: 'dev', name: 'Dev Admin' } };
  }
  if (!initData) return { ok: false, error: 'Missing initData' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'Missing hash' };

  const entries = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN || '').digest();
  const computedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return { ok: false, error: 'Invalid signature' };

  let user;
  try {
    user = JSON.parse(params.get('user'));
  } catch (e) {
    return { ok: false, error: 'Bad user JSON' };
  }
  return { ok: true, user: { id: String(user.id), name: [user.first_name, user.last_name].filter(Boolean).join(' ') } };
}

export async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Telegram sendMessage error:', res.status, t);
  }
}

export async function notifyAdmins(text) {
  const ids = (process.env.ADMIN_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  await Promise.all(ids.map(id => sendTelegramMessage(id, text)));
}
