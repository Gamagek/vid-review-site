import { Router } from 'itty-router';

const router = Router();

router.get('/api/test', () => {
  return new Response(JSON.stringify({ message: 'API working' }), { headers: { 'Content-Type': 'application/json' } });
});

router.all('*', () => {
  return new Response('Vid.Best API', { headers: { 'Content-Type': 'text/plain' } });
});

export default {
  fetch: router.handle
};
