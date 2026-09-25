import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normUrl, connect, generateReply, generateReplyNonEmpty, completeOnce } from '../www/js/api/kobold.js';

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

// ---------- lorebook automático por personaje (docs/NOTES.md) ----------

test('generateReply inyecta en el prompt las entradas del lorebook del personaje que matchean el último mensaje', async () => {
  let capturedPrompt = '';
  const { server } = createFakeServer({
    onGenerateStream: async (res, body) => {
      capturedPrompt = body.prompt;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"ok"}\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    await generateReply({
      character: makeCharacter({
        lorebook: [
          { id: '1', keys: ['café'], content: 'Se conocieron en un café.', updated: 1, source: 'auto' },
          { id: '2', keys: ['playa'], content: 'Nunca fueron a la playa.', updated: 1, source: 'auto' }
        ]
      }),
      chat: { scenario: '' },
      messages: [{ role: 'user', text: 'Hablemos del café de esta mañana', ts: 1 }],
      settings: makeSettings(base)
    });
    assert.match(capturedPrompt, /Se conocieron en un café\./);
    assert.ok(!capturedPrompt.includes('Nunca fueron a la playa.'));
  } finally {
    server.close();
  }
});

test('generateReply no agrega ningún bloque de lorebook si ninguna entrada matchea', async () => {
  let capturedPrompt = '';
  const { server } = createFakeServer({
    onGenerateStream: async (res, body) => {
      capturedPrompt = body.prompt;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"ok"}\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    await generateReply({
      character: makeCharacter({ lorebook: [{ id: '1', keys: ['playa'], content: 'x', updated: 1, source: 'auto' }] }),
      chat: { scenario: '' },
      messages: [{ role: 'user', text: 'Hola, ¿cómo estás?', ts: 1 }],
      settings: makeSettings(base)
    });
    assert.ok(!capturedPrompt.includes('Known facts'));
  } finally {
    server.close();
  }
});

test('generateReply comparte el lorebook del personaje sin importar el chat pasado', async () => {
  let capturedPrompt = '';
  const { server } = createFakeServer({
    onGenerateStream: async (res, body) => {
      capturedPrompt = body.prompt;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"ok"}\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    const character = makeCharacter({
      lorebook: [{ id: '1', keys: ['tren'], content: 'Se conocieron en un tren.', updated: 1, source: 'auto' }]
    });
    // Dos chats distintos del mismo personaje: el lorebook es el mismo para ambos.
    await generateReply({
      character,
      chat: { id: 'chat-a', scenario: 'Primera cita' },
      messages: [{ role: 'user', text: 'El tren llegó tarde', ts: 1 }],
      settings: makeSettings(base)
    });
    assert.match(capturedPrompt, /Se conocieron en un tren\./);
  } finally {
    server.close();
  }
});

// ---------- completeOnce (extracción de lorebook, sin streaming) ----------

test('completeOnce devuelve el texto de /api/v1/generate', async () => {
  const { server } = createFakeServer({ fallbackText: '[{"keys":["a"],"content":"x"}]' });
  const base = await listen(server);
  try {
    const text = await completeOnce('Un prompt de extracción', makeSettings(base));
    assert.equal(text, '[{"keys":["a"],"content":"x"}]');
  } finally {
    server.close();
  }
});

test('completeOnce usa opts.temp en vez de settings.temp', async () => {
  let capturedBody = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [{ text: 'ok' }] }));
  });
  const base = await listen(server);
  try {
    await completeOnce('prompt', makeSettings(base, { temp: 0.85 }), { temp: 0.2 });
    assert.equal(capturedBody.temperature, 0.2);
  } finally {
    server.close();
  }
});

test('completeOnce lanza INVALID_URL si settings.url está vacía', async () => {
  await assert.rejects(() => completeOnce('prompt', makeSettings('')), (err) => {
    assert.equal(err.code, 'INVALID_URL');
    return true;
  });
});

test('completeOnce lanza NETWORK si no hay servidor escuchando', async () => {
  await assert.rejects(() => completeOnce('prompt', makeSettings('http://127.0.0.1:1')), (err) => {
    assert.equal(err.code, 'NETWORK');
    return true;
  });
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

// ---------- generateReplyNonEmpty (FMT-001) ----------

test('generateReply en modo chat envía "\\n" en stop (un solo párrafo)', async () => {
  let seen = null;
  const { server } = createFakeServer({
    onChatStream: async (res, body) => {
      seen = body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { mode: 'chat' })
    });
    assert.ok(seen.stop.includes('\n'));
    assert.ok(seen.stop.includes('\nEdgar:'));
  } finally {
    server.close();
  }
});

test('generateReplyNonEmpty: una respuesta vacía provoca un solo reintento y devuelve la segunda', async () => {
  const texts = ['  ', 'Hola'];
  let calls = 0;
  const fake = async () => ({ text: texts[calls++], truncated: false, aborted: false });
  const result = await generateReplyNonEmpty({ character: makeCharacter(), messages: [] }, fake);
  assert.equal(calls, 2);
  assert.equal(result.text, 'Hola');
});

test('generateReplyNonEmpty: si el reintento también sale vacío devuelve vacío tras solo 2 intentos', async () => {
  let calls = 0;
  const fake = async () => {
    calls++;
    return { text: '', truncated: false, aborted: false };
  };
  const result = await generateReplyNonEmpty({ character: makeCharacter(), messages: [] }, fake);
  assert.equal(calls, 2);
  assert.equal(result.text, '');
});

test('generateReplyNonEmpty: una respuesta normal no se reintenta', async () => {
  let calls = 0;
  const fake = async () => {
    calls++;
    return { text: 'Hola', truncated: false, aborted: false };
  };
  await generateReplyNonEmpty({ character: makeCharacter(), messages: [] }, fake);
  assert.equal(calls, 1);
});

test('generateReplyNonEmpty: un aborto no se reintenta', async () => {
  let calls = 0;
  const fake = async () => {
    calls++;
    return { text: '', truncated: false, aborted: true };
  };
  const result = await generateReplyNonEmpty({ character: makeCharacter(), messages: [] }, fake);
  assert.equal(calls, 1);
  assert.equal(result.aborted, true);
});

test('generateReplyNonEmpty: los errores se propagan sin reintentar', async () => {
  let calls = 0;
  const fake = async () => {
    calls++;
    throw new Error('boom');
  };
  await assert.rejects(generateReplyNonEmpty({ character: makeCharacter(), messages: [] }, fake), /boom/);
  assert.equal(calls, 1);
});

test('generateReplyNonEmpty: no le pasa a onToken texto de espacios; el usuario no ve nada del intento vacío', async () => {
  const scripts = [['\n', ' '], ['\n', 'Ho', 'la']];
  let n = 0;
  const fake = async (o) => {
    const chunks = scripts[n++];
    let text = '';
    for (const c of chunks) {
      text += c;
      if (o.onToken) o.onToken(c);
    }
    return { text: text.trim(), truncated: false, aborted: false };
  };
  const seen = [];
  const result = await generateReplyNonEmpty(
    { character: makeCharacter(), messages: [], onToken: (c) => seen.push(c) },
    fake
  );
  assert.equal(n, 2);
  assert.equal(result.text, 'Hola');
  // Primer intento: nada. Segundo: lo retenido ("\n"+"Ho") se entrega junto y luego "la".
  assert.equal(seen.join(''), '\nHola');
  assert.equal(seen[0], '\nHo');
});

test('generateReplyNonEmpty con el servidor simulado: 1.ª respuesta vacía, 2.ª con texto', async () => {
  let calls = 0;
  const { server } = createFakeServer({
    onChatStream: async (res) => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (calls > 1) res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    const result = await generateReplyNonEmpty({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { mode: 'chat' })
    });
    assert.equal(calls, 2);
    assert.equal(result.text, 'Hola');
  } finally {
    server.close();
  }
});

// ---------- FMT-002: formatAssist (la respuesta arranca dentro de una acción) ----------

function chatStreamer(chunks, capture) {
  return async (res, body) => {
    capture.body = body;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const c of chunks) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  };
}

test('FMT-002 (plantilla): con formatAssist envía el mensaje assistant "*" y antepone "*" al texto', async () => {
  const seen = {};
  const { server } = createFakeServer({ onChatStream: chatStreamer(['I smile', ' softly.* Hi!'], seen) });
  const base = await listen(server);
  try {
    const tokens = [];
    const result = await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { mode: 'chat', formatAssist: true }),
      onToken: (c) => tokens.push(c)
    });
    assert.deepEqual(seen.body.messages.at(-1), { role: 'assistant', content: '*' });
    assert.equal(result.text, '*I smile softly.* Hi!');
    assert.equal(tokens.join(''), '*I smile softly.* Hi!');
  } finally {
    server.close();
  }
});

test('FMT-002 (plantilla): sin formatAssist no envía assistant final ni cambia el texto', async () => {
  const seen = {};
  const { server } = createFakeServer({ onChatStream: chatStreamer(['Hola', ' mundo'], seen) });
  const base = await listen(server);
  try {
    const result = await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { mode: 'chat' })
    });
    assert.equal(seen.body.messages.at(-1).role, 'user');
    assert.equal(result.text, 'Hola mundo');
  } finally {
    server.close();
  }
});

test('FMT-002 (texto simple): con formatAssist el prompt termina en " *" y el texto lleva el "*"', async () => {
  let seen = null;
  const { server } = createFakeServer({
    onGenerateStream: async (res, body) => {
      seen = body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"token":"I wave."}\n\n');
      res.write('data: {"token":"*"}\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    const result = await generateReply({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { formatAssist: true })
    });
    assert.ok(seen.prompt.endsWith('\nLuna: *'));
    assert.equal(result.text, '*I wave.*');
  } finally {
    server.close();
  }
});

test('FMT-002: si el modelo ya abre su propia acción con "*" no se duplica; una respuesta vacía sigue vacía', async () => {
  const seen = {};
  const a = createFakeServer({ onChatStream: chatStreamer(['*I nod.* Sure'], seen) });
  const baseA = await listen(a.server);
  const b = createFakeServer({ onChatStream: chatStreamer(['', '  '], seen) });
  const baseB = await listen(b.server);
  try {
    const settingsA = makeSettings(baseA, { mode: 'chat', formatAssist: true });
    const ra = await generateReply({ character: makeCharacter(), messages: [{ role: 'user', text: 'Hi', ts: 1 }], settings: settingsA });
    assert.equal(ra.text, '*I nod.* Sure');
    const rb = await generateReply({ character: makeCharacter(), messages: [{ role: 'user', text: 'Hi', ts: 1 }], settings: makeSettings(baseB, { mode: 'chat', formatAssist: true }) });
    assert.equal(rb.text, '');
  } finally {
    a.server.close();
    b.server.close();
  }
});

test('FMT-002: con formatAssist, la respuesta vacía se reintenta una vez (generateReplyNonEmpty intacto)', async () => {
  let calls = 0;
  const { server } = createFakeServer({
    onChatStream: async (res) => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (calls > 1) res.write('data: {"choices":[{"delta":{"content":"I smile.* Hi"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });
  const base = await listen(server);
  try {
    const result = await generateReplyNonEmpty({
      character: makeCharacter(),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base, { mode: 'chat', formatAssist: true })
    });
    assert.equal(calls, 2);
    assert.equal(result.text, '*I smile.* Hi');
  } finally {
    server.close();
  }
});

// ---------- UI-011: maxLen/temp ya no tienen control en Ajustes, pero se siguen enviando ----------

test('generateReply sigue enviando settings.maxLen y settings.temp (modo texto simple y plantilla)', async () => {
  for (const mode of ['plain', 'chat']) {
    let capturedBody = null;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(mode === 'chat'
        ? 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: [DONE]\n\n'
        : 'data: {"token":"Hola"}\n\n');
    });
    const base = await listen(server);
    try {
      await generateReply({
        character: makeCharacter(),
        messages: [{ role: 'user', text: 'Hola', ts: 1 }],
        settings: makeSettings(base, { mode, maxLen: 310, temp: 0.55 }),
        onToken: () => {}
      });
      assert.equal(capturedBody.temperature, 0.55, mode);
      assert.equal(mode === 'chat' ? capturedBody.max_tokens : capturedBody.max_length, 310, mode);
    } finally {
      server.close();
    }
  }
});

// ---------- UI-010: generateReply informa qué recuerdos viajaron en el prompt ----------

test('generateReply devuelve loreUsed: [] sin coincidencias y las entradas realmente enviadas con ellas', async () => {
  const { server } = createFakeServer();
  const base = await listen(server);
  const lore = [
    { id: 'a', keys: ['x'], content: 'Sam le contó a Mia que su perro Bruno le teme a los truenos.', updated: 1, source: 'manual', always: true },
    { id: 'b', keys: ['café'], content: 'Se conocieron en un café.', updated: 1, source: 'auto' },
    { id: 'c', keys: ['playa'], content: 'Sam nunca fue a la playa.', updated: 1, source: 'auto' },
  ];
  try {
    const none = await generateReply({
      character: makeCharacter({ lorebook: [lore[1], lore[2]] }),
      messages: [{ role: 'user', text: 'Hola', ts: 1 }],
      settings: makeSettings(base),
    });
    assert.deepEqual(none.loreUsed, []);

    const some = await generateReply({
      character: makeCharacter({ lorebook: lore }),
      messages: [{ role: 'user', text: 'Vamos a tomar un café', ts: 1 }],
      settings: makeSettings(base),
    });
    assert.deepEqual(some.loreUsed.map((u) => [u.id, u.always]), [['a', true], ['b', false]]);
    assert.equal(some.loreUsed[1].content, 'Se conocieron en un café.');
  } finally {
    server.close();
  }
});
