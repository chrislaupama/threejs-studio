const CANONICAL_HOST = 'threejs.studio';

export default {
  fetch(request: Request): Response {
    const destination = new URL(request.url);
    destination.protocol = 'https:';
    destination.hostname = CANONICAL_HOST;
    destination.port = '';

    return new Response(null, {
      status: 308,
      headers: {
        'Cache-Control': 'public, max-age=3600',
        Location: destination.toString(),
      },
    });
  },
};
