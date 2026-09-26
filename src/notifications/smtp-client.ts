/**
 * In-Process RFC 5321 SMTP Client (MVP-12)
 *
 * Lightweight, zero-external-dependency SMTP transport using Node.js
 * built-in `node:net` and `node:tls` modules.
 * Fully compatible with standard email relays (Gmail, Zoho, SendGrid, Amazon SES, local Postfix).
 */

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export interface SmtpConnectionOptions {
  host: string;
  port: number;
  secure?: boolean; // Port 465 SSL/TLS direct
  requireTls?: boolean; // Port 587 STARTTLS upgrade
  auth?: {
    user: string;
    pass: string;
  };
  timeoutMs?: number;
  rejectUnauthorized?: boolean;
}

export interface SmtpMailOptions {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

export interface SmtpSendResult {
  success: boolean;
  messageId: string;
  response?: string;
  error?: string;
}

export interface ISmtpTransport {
  sendMail(options: SmtpMailOptions): Promise<SmtpSendResult>;
}

export class MockSmtpTransport implements ISmtpTransport {
  public readonly sentMails: SmtpMailOptions[] = [];
  public shouldFail = false;
  public failErrorMessage = 'Simulated SMTP failure';

  async sendMail(options: SmtpMailOptions): Promise<SmtpSendResult> {
    if (this.shouldFail) {
      return {
        success: false,
        messageId: '',
        error: this.failErrorMessage,
      };
    }

    this.sentMails.push({ ...options });
    const messageId = `<mock-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@basic-vms.local>`;
    return {
      success: true,
      messageId,
      response: '250 2.0.0 OK: message queued',
    };
  }

  clear(): void {
    this.sentMails.length = 0;
    this.shouldFail = false;
  }
}

export class NodeSocketSmtpClient implements ISmtpTransport {
  constructor(private readonly options: SmtpConnectionOptions) {}

  private extractEmailAddress(addressStr: string): string {
    const match = addressStr.match(/<([^>]+)>/);
    return match ? match[1].trim() : addressStr.trim();
  }

  private encodeSubject(subject: string): string {
    // Encodes UTF-8 string to RFC 2047 MIME encoded-word if non-ASCII
    if (/^[\x20-\x7E]*$/.test(subject)) {
      return subject;
    }
    const b64 = Buffer.from(subject, 'utf8').toString('base64');
    return `=?UTF-8?B?${b64}?=`;
  }

  private readResponse(socket: net.Socket | tls.TLSSocket, timeoutMs: number): Promise<{ code: number; message: string }> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onData = (data: Buffer) => {
        buffer += data.toString('utf8');
        // Check for complete SMTP response line: "XYZ ...\r\n"
        // Multiline responses have '-' after the code: "XYZ-...\r\n" until "XYZ ...\r\n"
        const lines = buffer.split('\r\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          const match = line.match(/^(\d{3})(?: (.*))?$/);
          if (match) {
            cleanup();
            resolve({
              code: parseInt(match[1], 10),
              message: buffer.trim(),
            });
            return;
          }
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('SMTP socket closed prematurely by remote host'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
      };

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
    });
  }

  private async sendCommand(
    socket: net.Socket | tls.TLSSocket,
    cmd: string,
    timeoutMs: number
  ): Promise<{ code: number; message: string }> {
    socket.write(cmd + '\r\n');
    return this.readResponse(socket, timeoutMs);
  }

  async sendMail(mail: SmtpMailOptions): Promise<SmtpSendResult> {
    const timeoutMs = this.options.timeoutMs ?? 10000;
    const isDirectTls = Boolean(this.options.secure || this.options.port === 465);
    const requireTls = Boolean(this.options.requireTls ?? (this.options.port === 587));

    let socket: net.Socket | tls.TLSSocket;

    try {
      if (isDirectTls) {
        socket = tls.connect({
          host: this.options.host,
          port: this.options.port,
          rejectUnauthorized: this.options.rejectUnauthorized ?? false,
        });
      } else {
        socket = net.connect({
          host: this.options.host,
          port: this.options.port,
        });
      }

      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('secureConnect', () => resolve());
        socket.once('error', (err) => reject(err));
      });

      // 1. Initial greeting (220)
      const greeting = await this.readResponse(socket, timeoutMs);
      if (greeting.code !== 220) {
        throw new Error(`Unexpected greeting: ${greeting.message}`);
      }

      // 2. EHLO
      const localHostname = 'basic-vms.local';
      let ehlo = await this.sendCommand(socket, `EHLO ${localHostname}`, timeoutMs);
      if (ehlo.code !== 250) {
        // Fallback to HELO if EHLO rejected
        ehlo = await this.sendCommand(socket, `HELO ${localHostname}`, timeoutMs);
        if (ehlo.code !== 250) {
          throw new Error(`HELO rejected: ${ehlo.message}`);
        }
      }

      // 3. STARTTLS upgrade if required
      if (!isDirectTls && requireTls) {
        const starttls = await this.sendCommand(socket, 'STARTTLS', timeoutMs);
        if (starttls.code !== 220) {
          throw new Error(`STARTTLS rejected (${starttls.code}): ${starttls.message}`);
        }

        // Upgrade socket to TLS
        socket = tls.connect({
          socket: socket as net.Socket,
          host: this.options.host,
          rejectUnauthorized: this.options.rejectUnauthorized ?? false,
        });

        await new Promise<void>((resolve, reject) => {
          socket.once('secureConnect', () => resolve());
          socket.once('error', (err) => reject(err));
        });

        // Re-issue EHLO after TLS handshake
        ehlo = await this.sendCommand(socket, `EHLO ${localHostname}`, timeoutMs);
        if (ehlo.code !== 250) {
          throw new Error(`Post-TLS EHLO rejected: ${ehlo.message}`);
        }
      }

      // 4. Authentication (AUTH LOGIN)
      if (this.options.auth && this.options.auth.user) {
        const authStart = await this.sendCommand(socket, 'AUTH LOGIN', timeoutMs);
        if (authStart.code !== 334) {
          throw new Error(`AUTH LOGIN initiation failed: ${authStart.message}`);
        }

        const userB64 = Buffer.from(this.options.auth.user).toString('base64');
        const userResp = await this.sendCommand(socket, userB64, timeoutMs);
        if (userResp.code !== 334) {
          throw new Error(`AUTH username rejected: ${userResp.message}`);
        }

        const passB64 = Buffer.from(this.options.auth.pass).toString('base64');
        const passResp = await this.sendCommand(socket, passB64, timeoutMs);
        if (passResp.code !== 235) {
          throw new Error(`Authentication credentials rejected: ${passResp.message}`);
        }
      }

      // 5. MAIL FROM
      const fromEmail = this.extractEmailAddress(mail.from);
      const mailFrom = await this.sendCommand(socket, `MAIL FROM:<${fromEmail}>`, timeoutMs);
      if (mailFrom.code !== 250) {
        throw new Error(`MAIL FROM rejected: ${mailFrom.message}`);
      }

      // 6. RCPT TO (for each recipient)
      if (!mail.to || mail.to.length === 0) {
        throw new Error('No recipient email addresses provided');
      }

      for (const recipient of mail.to) {
        const rcptEmail = this.extractEmailAddress(recipient);
        const rcptResp = await this.sendCommand(socket, `RCPT TO:<${rcptEmail}>`, timeoutMs);
        if (rcptResp.code !== 250 && rcptResp.code !== 251) {
          throw new Error(`Recipient rejected (${rcptEmail}): ${rcptResp.message}`);
        }
      }

      // 7. DATA
      const dataResp = await this.sendCommand(socket, 'DATA', timeoutMs);
      if (dataResp.code !== 354) {
        throw new Error(`DATA rejected: ${dataResp.message}`);
      }

      // 8. Stream MIME Message Body
      const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@${localHostname}>`;
      const dateHeader = new Date().toUTCString();
      const subjectHeader = this.encodeSubject(mail.subject);

      const mimeMessage = [
        `From: ${mail.from}`,
        `To: ${mail.to.join(', ')}`,
        `Subject: ${subjectHeader}`,
        `Date: ${dateHeader}`,
        `Message-ID: ${messageId}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        mail.html,
        '',
        '.',
      ].join('\r\n');

      const sendBodyResp = await this.sendCommand(socket, mimeMessage, timeoutMs);
      if (sendBodyResp.code !== 250) {
        throw new Error(`Failed delivering message data: ${sendBodyResp.message}`);
      }

      // 9. QUIT
      try {
        await this.sendCommand(socket, 'QUIT', 2000);
      } catch {
        // Safe to ignore QUIT error if message already acknowledged (250)
      }

      socket.destroy();

      return {
        success: true,
        messageId,
        response: sendBodyResp.message,
      };
    } catch (err: any) {
      if (socket!) {
        socket.destroy();
      }
      return {
        success: false,
        messageId: '',
        error: err.message || 'Unknown SMTP error',
      };
    }
  }
}
