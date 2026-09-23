import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normUrl, connect, generateReply } from '../www/js/api/kobold.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Servidor HTTP de prueba que imita las rutas de KoboldCpp usadas por
// kobold.js. `opts` permite forzar comportamientos específicos por test.
function createFakeServer(opts = {}) {
  const state = { abortCalls: [] };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }

    if (req.method === 'GET' && req.url === '/api/v1/model') {
      if (opts.modelStatus) {
        res.writeHead(opts.modelStatus);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: opts.model || 'koboldcpp/TestModel' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/extra/true_max_context_length') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: opts.ctxValue || 8192 }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/extra/generate/stream') {
      if (opts.streamStatus === 404) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (opts.onGenerateStream) {
        await opts.onGenerateStream(res, body);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Una línea SSE partida a la mitad entre dos escrituras de red.
      res.write('data: {"tok');
      await delay(10);
      res.write('en":"Hola"}\n\n');
      await delay(10);
      res.write('data: {"token":" mundo"}\n\n');
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (opts.chatStatus === 404) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (opts.onChatStream) {
        await opts.onChatStream(res, body);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
      await delay(10);
      res.write('data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n');
      await delay(10);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/generate') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [{ text: opts.fallbackText ?? 'Respuesta de respaldo' }] }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/extra/abort') {
      state.abortCalls.push(body.genkey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return { server, state };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function makeCharacter(overrides = {}) {
  return {
    id: 'c1',
    name: 'Luna',
    avatar: '',
    card: {
      name: 'Luna',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null
    },
    avatarMode: 'mini',
    created: Date.now(),
    updated: Date.now(),
    last: '',
    ...overrides
  };
}

function makeSettings(url, overrides = {}) {
  return { url, user: 'Edgar', maxLen: 220, temp: 0.85, mode: 'plain', ctx: 4096, ...overrides };
}

// ---------- normUrl ----------

test('normUrl agrega http:// si falta y devuelve solo el origen', () => {
  assert.equal(normUrl('100.1.1.1:5001'), 'http://100.1.1.1:5001');
  assert.equal(normUrl('http://100.1.1.1:5001/algo/ruta#frag'), 'http://100.1.1.1:5001');
  assert.equal(normUrl('https://midominio.com:8443/'), 'https://midominio.com:8443');
});

test('normUrl devuelve cadena vacía con URLs vacías o inválidas', () => {
  assert.equal(normUrl(''), '');
  assert.equal(normUrl('   '), '');
  assert.equal(normUrl('http://'), '');
});

// ---------- connect ----------

test('connect() se conecta y devuelve url, modelo y contexto', async () => {
  const { server } = createFakeServer({ model: 'koboldcpp/MiModelo', ctxValue: 8192 });
  const base = await listen(server);
  try {
    const result = await connect(base);
    assert.equal(result.url, base);
    assert.equal(result.model, 'MiModelo');
    assert.equal(result.ctx, 8192);
  } finally {
    server.close();
  }
});

test('connect() usa 4096 de contexto por defecto si ese endpoint falla', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/v1/model') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'koboldcpp/TestModel' }));
      return;
    }
    // El endpoint de contexto no existe en este servidor: connect() debe
    // tratarlo como opcional y seguir adelante con el valor por defecto.
    res.writeHead(404);
    res.end();
  });
  const base = await listen(server);
  try {
    const result = await connect(base);
    assert.equal(result.ctx, 4096);
  } finally {
    server.close();
  }
});

test('connect() lanza INVALID_URL con una URL vacía', async () => {
  await assert.rejects(() => connect(''), (err) => {
    assert.equal(err.code, 'INVALID_URL');
    assert.match(err.message, /no es válida/);
    return true;
  });
});

test('connect() lanza NETWORK si no hay servidor escuchando', async () => {
  await assert.rejects(() => connect('http://127.0.0.1:1'), (err) => {
    assert.equal(err.code, 'NETWORK');
    assert.match(err.message, /Tailscale/);
    return true;
  });
});

test('connect() lanza HTTP si el servidor responde con error', async () => {
  const { server } = createFakeServer({ modelStatus: 500 });
  const base = await listen(server);
  try {
    await assert.rejects(() => connect(base), (err) => {
      assert.equal(err.code, 'HTTP');
      assert.match(err.message, /500/);
      return true;
    });
  } finally {
    server.close();
  }
});

// ---------- generateReply: streaming normal ----------

test('generateReply en modo plain transmite y reensambla tokens partidos entre chunks', async () => {
  const { server } = createFakeServer();
  const base = await listen(server);
  try {
    const chunks = [];
    const result = await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base),
      onToken: (t) => chunks.push(t)
    });
    assert.equal(chunks.join(''), 'Hola mundo');
    assert.equal(result.text, 'Hola mundo');
    assert.equal(result.truncated, false);
    assert.equal(result.aborted, false);
  } finally {
    server.close();
  }
});

test('generateReply en modo chat usa /v1/chat/completions y respeta [DONE]', async () => {
  const { server } = createFakeServer();
  const base = await listen(server);
  try {
    const result = await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { mode: 'chat' })
    });
    assert.equal(result.text, 'Hola mundo');
  } finally {
    server.close();
  }
});

test('generateReply aplica cleanReply quitando el prefijo "Nombre:"', async () => {
  const { server } = createFakeServer({
    onGenerateStream: async (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"Luna: "}\n\n');
      res.write('data: {"token":"Hola."}\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    const result = await generateReply({
      character: makeCharacter(),
      messages: [],
      settings: makeSettings(base)
    });
    assert.equal(result.text, 'Hola.');
  } finally {
    server.close();
  }
});

// ---------- respaldo sin streaming ----------

test('generateReply usa /api/v1/generate cuando el streaming responde 404', async () => {
  const { server } = createFakeServer({ streamStatus: 404, fallbackText: 'Respuesta sin streaming' });
  const base = await listen(server);
  try {
    const result = await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base)
    });
    assert.equal(result.text, 'Respuesta sin streaming');
    assert.equal(result.aborted, false);
  } finally {
    server.close();
  }
});

// ---------- abortar ----------

test('generateReply resuelve con aborted:true y avisa al servidor', async () => {
  const { server, state } = createFakeServer({
    onGenerateStream: async (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"Hola"}\n\n');
      await delay(400); // el test aborta antes de que esto importe
      res.write('data: {"token":" nunca llega"}\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    const ctrl = new AbortController();
    const promise = generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base),
      signal: ctrl.signal
    });
    setTimeout(() => ctrl.abort(), 60);
    const result = await promise;
    assert.equal(result.aborted, true);
    assert.equal(result.text, 'Hola');

    await delay(30);
    assert.equal(state.abortCalls.length, 1);
  } finally {
    server.close();
  }
});

// ---------- errores ----------

test('generateReply lanza NETWORK si el servidor no está disponible', async () => {
  await assert.rejects(
    () =>
      generateReply({
        character: makeCharacter(),
        messages: [],
        settings: makeSettings('http://127.0.0.1:1')
      }),
    (err) => {
      assert.equal(err.code, 'NETWORK');
      assert.match(err.message, /Tailscale/);
      return true;
    }
  );
});

test('generateReply lanza INVALID_URL si la URL de settings está vacía', async () => {
  await assert.rejects(
    () => generateReply({ character: makeCharacter(), messages: [], settings: makeSettings('') }),
    (err) => {
      assert.equal(err.code, 'INVALID_URL');
      return true;
    }
  );
});

test('generateReply lanza HTTP si el servidor responde con error antes de transmitir', async () => {
  const { server } = createFakeServer({
    onGenerateStream: async (res) => {
      res.writeHead(503);
      res.end();
    }
  });
  const base = await listen(server);
  try {
    await assert.rejects(
      () =>
        generateReply({
          character: makeCharacter(),
          messages: [],
          settings: makeSettings(base)
        }),
      (err) => {
        assert.equal(err.code, 'HTTP');
        assert.match(err.message, /503/);
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('generateReply devuelve el texto recibido (truncated:true) si la conexión se corta a mitad del streaming', async () => {
  const { server } = createFakeServer({
    onGenerateStream: async (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"Hola"}\n\n');
      await delay(20);
      res.destroy(); // corte abrupto de la conexión, no un cierre normal
    }
  });
  const base = await listen(server);
  try {
    const result = await generateReply({
      character: makeCharacter(),
      messages: [],
      settings: makeSettings(base)
    });
    assert.equal(result.aborted, false);
    assert.equal(result.truncated, true);
    assert.equal(result.text, 'Hola');
  } finally {
    server.close();
  }
});
