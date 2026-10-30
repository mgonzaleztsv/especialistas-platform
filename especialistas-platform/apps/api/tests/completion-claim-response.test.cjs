const test = require('node:test');
const assert = require('node:assert/strict');

const exports_ = require(
  '../dist/job-requests/job-requests.controller.js'
);

const Controller = Object.values(exports_).find(
  x => typeof x === 'function' &&
  x.prototype?.respondCompletionClaim
);

assert.ok(Controller, 'Controlador no localizado');

function setup(opts = {}) {
  const events = [];
  let status = opts.status || 'PENDING';
  let savedNotes = null;
  let respondedAt = null;

  const tx = {
    $queryRaw: async (strings, ...values) => {
      assert.match(strings.join('?'), /FOR UPDATE/);
      assert.equal(values[0], 'job-1');
      events.push('lock');
      return [{ id: 'job-1' }];
    },
    jobRequest: {
      findFirst: async args => {
        events.push('job');
        assert.equal(
          args.where.proposals.some.specialistId,
          'specialist-1'
        );
        return opts.unauthorized ? null : { id: 'job-1' };
      }
    },
    completionClaim: {
      findFirst: async () =>
        status === 'PENDING' ? { id: 'claim-1' } : null,
      updateMany: async args => {
        events.push('update');
        if (status !== 'PENDING') return { count: 0 };
        status = args.data.status;
        savedNotes = args.data.specialistResponseNotes;
        respondedAt = args.data.specialistRespondedAt;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        id: 'claim-1',
        status,
        specialistResponseNotes: savedNotes,
        specialistRespondedAt: respondedAt
      })
    }
  };

  const context = {
    prisma: {
      specialist: {
        findUnique: async () =>
          opts.noProfile ? null : { id: 'specialist-1' }
      },
      $transaction: async (fn, config) => {
        assert.equal(config.isolationLevel, 'Serializable');
        return fn(tx);
      }
    },
    retryTransaction: fn => fn()
  };

  const request = { user: { userId: 'specialist-user-1' } };

  async function respond(action, notes = 'Explicación suficiente para responder') {
    return Controller.prototype.respondCompletionClaim.call(
      context,
      request,
      'job-1',
      'claim-1',
      { action, notes }
    );
  }

  return {
    respond,
    events,
    state: () => ({ status, savedNotes, respondedAt })
  };
}

test('823.1 - Especialista acepta corrección', async () => {
  const s = setup();
  const result = await s.respond('ACCEPT_CORRECTION');

  assert.equal(result.status, 'CORRECTION_REQUESTED');
  assert.ok(result.specialistRespondedAt instanceof Date);
  assert.ok(result.specialistResponseNotes);
  assert.deepEqual(s.events, ['lock', 'job', 'update']);
});

test('823.2 - Especialista disputa reclamación', async () => {
  const s = setup();
  const result = await s.respond('DISPUTE');

  assert.equal(result.status, 'DISPUTED');
  assert.ok(result.specialistRespondedAt instanceof Date);
});

test('823.3 - Tercero rechazado', async () => {
  const s = setup({ unauthorized: true });

  await assert.rejects(
    s.respond('DISPUTE')
  );

  assert.equal(s.state().status, 'PENDING');
  assert.ok(!s.events.includes('update'));
});

test('823.4 - Respuesta duplicada rechazada', async () => {
  const s = setup();

  await s.respond('ACCEPT_CORRECTION');

  await assert.rejects(
    s.respond('DISPUTE')
  );

  assert.equal(s.state().status, 'CORRECTION_REQUESTED');
  assert.equal(s.events.filter(x => x === 'update').length, 1);
});

test('823.5 - Explicación corta rechazada', async () => {
  const s = setup();

  await assert.rejects(
    s.respond('DISPUTE', 'No')
  );

  assert.equal(s.state().status, 'PENDING');
  assert.deepEqual(s.events, []);
});

test('823.6 - Acción desconocida rechazada', async () => {
  const s = setup();

  await assert.rejects(
    s.respond('CANCEL')
  );

  assert.equal(s.state().status, 'PENDING');
  assert.deepEqual(s.events, []);
});
