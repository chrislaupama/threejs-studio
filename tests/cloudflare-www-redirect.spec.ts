import { expect, test } from '@playwright/test';
import wwwRedirectWorker from '../cloudflare/www-redirect';

test('www worker permanently redirects to the canonical HTTPS host', () => {
  const response = wwwRedirectWorker.fetch(
    new Request('http://www.threejs.studio/projects/demo?mode=preview'),
  );

  expect(response.status).toBe(308);
  expect(response.headers.get('location')).toBe(
    'https://threejs.studio/projects/demo?mode=preview',
  );
  expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
});
