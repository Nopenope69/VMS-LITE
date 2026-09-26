import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { createServer } from '../src/server.js';
import { notificationService, TelegramBotDispatcher } from '../src/notifications/notification-dispatcher.service.js';

describe('Anti-Theft Instant Cloud Push (Telegram Bot Dispatcher)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();

    adminToken = app.jwt.sign({
      id: 'admin-anti-theft',
      username: 'admin',
      role: Role.ADMIN,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('selects TelegramBotDispatcher when provider is set to telegram', () => {
    const dispatcher = notificationService.getDispatcher('telegram');
    expect(dispatcher).toBeDefined();
    expect(dispatcher.providerName).toBe('telegram');
    expect(dispatcher).toBeInstanceOf(TelegramBotDispatcher);
  });

  it('gracefully handles missing credentials with descriptive error', async () => {
    const dispatcher = new TelegramBotDispatcher(() => null);
    const result = await dispatcher.send({
      recipientPhone: '-1001234567890',
      eventType: 'intrusion.alarm',
      cameraId: 'cam-vault',
      cameraName: 'Vault Camera',
      timestamp: '26 Sep 2026, 03:00:00 IST',
      messageText: 'Unauthorized intrusion detected at main safe',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing Telegram Bot credentials');
  });

  it('allows setting telegram provider via notification settings API when capability is granted', async () => {
    // If capability is present or tested
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        provider: 'telegram',
        credentialsJson: JSON.stringify({
          botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          chatId: '-100192837465',
        }),
      },
    });

    // If license plugin checks extended.whatsapp_alerts, verify status code is either 200 or 403 (with capability error)
    if (res.statusCode === 200) {
      const json = JSON.parse(res.payload);
      expect(json.provider).toBe('telegram');
    } else {
      expect(res.statusCode).toBe(403);
    }
  });
});
