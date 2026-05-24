// VideoGrab - routes/telegram.js
const express = require('express');
const router = express.Router();
const telegramClient = require('../services/telegramClient');

// GET /telegram/status - Check if authenticated
router.get('/status', async (req, res) => {
  try {
    const status = await telegramClient.checkLoginStatus();
    res.json(status);
  } catch (error) {
    console.error('[Telegram Router] Status error:', error);
    res.status(500).json({ error: 'Failed to retrieve Telegram status.' });
  }
});

// POST /telegram/login - Send OTP code to phone number
router.post('/login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number in request body.' });
    }

    const phoneCodeHash = await telegramClient.sendOtp(phone);
    res.json({
      status: 'otp_sent',
      phoneCodeHash: phoneCodeHash
    });
  } catch (error) {
    console.error('[Telegram Router] Login error:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate login.' });
  }
});

// POST /telegram/otp - Submit code received on phone
router.post('/otp', async (req, res) => {
  try {
    const { phone, code, phoneCodeHash } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Missing OTP code in request.' });
    }

    const result = await telegramClient.verifyOtp(phone, phoneCodeHash, code);
    res.json(result);
  } catch (error) {
    console.error('[Telegram Router] OTP verification error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify OTP.' });
  }
});

// POST /telegram/2fa - Submit password for 2FA validation
router.post('/2fa', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Missing password in request.' });
    }

    const result = await telegramClient.verify2fa(password);
    res.json(result);
  } catch (error) {
    console.error('[Telegram Router] 2FA validation error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify 2FA password.' });
  }
});

// GET /telegram/chats - Get list of groups and channels
router.get('/chats', async (req, res) => {
  try {
    const chats = await telegramClient.getChats();
    res.json(chats);
  } catch (error) {
    console.error('[Telegram Router] Fetch chats error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch Telegram chats.' });
  }
});

// POST /telegram/logout - Log out and clear session state
router.post('/logout', async (req, res) => {
  try {
    const result = await telegramClient.logout();
    res.json(result);
  } catch (error) {
    console.error('[Telegram Router] Logout error:', error);
    res.status(500).json({ error: 'Failed to complete logout.' });
  }
});

module.exports = router;
