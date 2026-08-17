import { Router } from 'express';
import type { AuthService } from './AuthService.js';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const result = await authService.register(req.body);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post('/login', async (req, res) => {
    const result = await authService.login(req.body);
    res.status(result.success ? 200 : 401).json(result);
  });

  router.post('/guest', async (_req, res) => {
    const result = await authService.createGuestAccount();
    res.status(200).json(result);
  });

  return router;
}
