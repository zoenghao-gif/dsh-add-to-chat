/**
 * Add-to-Conversation — Host half.
 *
 * Delivery side: the Client stages a selected reply snippet here (via a private
 * slash command). On the next model step of that session we surface the snippet
 * through the *prompt context* channel — model-visible, but NOT written into the
 * user's message or the transcript.
 */

export const inject = ['commands', 'systemPrompt'];

/** Render the staged snippets as a compact, clearly-labelled quote. */
function buildQuote(texts) {
  const body = texts.join('\n\n');
  const quoted = body
    .split('\n')
    .map((line) => (line.length ? '> ' + line : '>'))
    .join('\n');
  return (
    '【用户在「加入对话」中从我的回复里选中的原文（仅作上下文，用户正文另见其消息）】\n' +
    quoted
  );
}

export function apply(ctx) {
  /** sessionId -> Array<{ id: string, text: string }> */
  const pending = new Map();

  const clear = (sessionId) => {
    if (sessionId !== undefined) pending.delete(sessionId);
  };

  const stageCommand = ctx.effect(() =>
    ctx.commands.register({
      name: 'dshquote',
      description:
        'Internal helper for Add-to-Conversation: stage or drop a selected quote for the next model step.',
      input: { hint: 'add <id> <base64> | remove <id> | clear' },
      recordInput: false,
      handler: (inv) => {
        try {
          const sessionId = inv.agent && inv.agent.id;
          if (!sessionId) return { kind: 'success' };
          let raw = String(inv.rawInput || '').trim();
          if (raw.startsWith('/')) {
            const sp = raw.indexOf(' ');
            raw = sp === -1 ? '' : raw.slice(sp + 1);
          }
          const parts = raw.split(/\s+/).filter(Boolean);
          const op = parts[0] || '';
          let list = pending.get(sessionId) || [];
          if (op === 'add') {
            const id = parts[1] || '';
            const b64 = parts[2] || '';
            if (id && b64) {
              const text = Buffer.from(b64, 'base64').toString('utf8');
              if (text) list = list.concat([{ id, text }]);
            }
          } else if (op === 'remove') {
            const id = parts[1] || '';
            list = list.filter((q) => q.id !== id);
          } else if (op === 'clear') {
            list = [];
          }
          if (list.length) pending.set(sessionId, list);
          else pending.delete(sessionId);
          return { kind: 'success' };
        } catch (err) {
          return { kind: 'error', text: 'dshquote failed: ' + (err && err.message ? err.message : err) };
        }
      },
    }),
  );

  // Delivers staged quotes to the model through the prompt-context channel.
  // Returns "" when this session has nothing staged, so ordinary turns are
  // byte-for-byte unchanged.
  const quoteContext = ctx.effect(() =>
    ctx.systemPrompt.context({
      name: 'add-to-chat:quote',
      order: 900,
      interpolate: false,
      text: (context) => {
        const agent = context && context.agent;
        if (!agent) return '';
        const list = pending.get(agent.id);
        if (!list || !list.length) return '';
        return buildQuote(list.map((q) => q.text));
      },
    }),
  );

  // Once the turn that carried the quote closes, drop it so later turns stay clean.
  const onTurnStopping = ctx.effect(() =>
    ctx.on('agent/turn-stopping', (payload) => {
      const agent = payload && payload.agent;
      if (agent) clear(agent.id);
    }),
  );

  const onDisposed = ctx.effect(() =>
    ctx.on('agent/disposed', (payload) => {
      const agent = payload && payload.agent;
      if (agent) clear(agent.id);
    }),
  );

  return () => {
    for (const dispose of [stageCommand, quoteContext, onTurnStopping, onDisposed]) {
      try {
        dispose();
      } catch (e) {
        /* ignore */
      }
    }
  };
}
