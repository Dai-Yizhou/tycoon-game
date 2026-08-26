import { Router } from 'express';
import type { AuthService } from './AuthService.js';
import { t } from '@game/shared';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/migrate-guest', async (req, res) => {
    let user: Awaited<ReturnType<AuthService['verifyAndLoadUser']>> | null = null;
    try {
      const token = readBearerToken(req.headers.authorization);
      user = token ? await authService.verifyAndLoadUser(token) : null;
    } catch {
      res.status(500).json({ success: false, error: t('server.authUnavailable') });
      return;
    }
    if (!user) {
      res.status(401).json({ success: false, error: 'authentication_required' });
      return;
    }
    if (!isCredentialsBody(req.body)) {
      res.status(400).json({ success: false, error: t('server.authInvalidCredentials') });
      return;
    }
    try {
      const result = await authService.migrateGuest(user.id, req.body);
      res.status(result.success ? 200 : 400).json(result);
    } catch {
      res.status(500).json({ success: false, error: t('server.authUnavailable') });
    }
  });

  router.post('/register', async (req, res) => {
    if (!isCredentialsBody(req.body)) {
      res.status(400).json({ success: false, error: t('server.authInvalidCredentials') });
      return;
    }
    try {
      const result = await authService.register(req.body);
      res.status(result.success ? 200 : 400).json(result);
    } catch {
      res.status(500).json({ success: false, error: t('server.authUnavailable') });
    }
  });

  router.post('/login', async (req, res) => {
    if (!isCredentialsBody(req.body)) {
      res.status(400).json({ success: false, error: t('server.authInvalidCredentials') });
      return;
    }
    try {
      const result = await authService.login(req.body);
      res.status(result.success ? 200 : 401).json(result);
    } catch {
      res.status(500).json({ success: false, error: t('server.authUnavailable') });
    }
  });

  router.post('/guest', async (_req, res) => {
    try {
      const result = await authService.createGuestAccount();
      res.status(200).json(result);
    } catch {
      res.status(500).json({ success: false, error: t('server.authUnavailable') });
    }
  });

  return router;
}

function readBearerToken(value: string | undefined): string | null {
  if (!value?.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function isCredentialsBody(body: unknown): body is { username: string; password: string } {
  if (typeof body !== 'object' || body === null) return false;
  const credentials = body as Record<string, unknown>;
  return typeof credentials.username === 'string' && typeof credentials.password === 'string';
}
