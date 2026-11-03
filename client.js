/**
 * Add-to-Conversation — Client half.
 *
 * Adds a right-click "加入对话" action over the conversation: the selected text
 * becomes a removable quote chip above the composer, and the Host half injects
 * that exact text into the next message so the model can see it.
 */

window.__ModuleLoader__.load({
  id: 'dsh-add-to-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Shared bridge between the two slot registrations (same module closure).
    const bridge = {
      menu: null,
      listeners: new Set(),
      sessionId: null,
      stage: null, // async (text) => void
      remove: null, // async (id) => void
      setMenu(next) {
        this.menu = next;
        for (const fn of Array.from(this.listeners)) {
          try {
            fn(next);
          } catch (e) {
            /* ignore listener errors */
          }
        }
      },
      subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      },
    };

    const CSS = `
.dshatc-chips{display:inline-flex;align-items:center;gap:6px;flex-wrap:nowrap;max-width:62%;}
.dshatc-chip{display:inline-flex;align-items:center;gap:5px;max-width:120px;box-sizing:border-box;
  background:#4D6BFE;color:#ffffff;border:0;
  border-radius:999px;padding:2px 4px 2px 9px;font-size:12px;line-height:1.4;user-select:none}
.dshatc-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshatc-chip-x{appearance:none;border:0;background:transparent;color:rgba(255,255,255,.85);
  cursor:pointer;font-size:14px;line-height:1;padding:0 2px;border-radius:999px}
.dshatc-chip-x:hover{color:#ffffff}
.dshatc-menu{position:fixed;z-index:2147483000;min-width:148px;box-sizing:border-box;pointer-events:auto;
  background:var(--dsw-alias-bg-overlay,#fff);
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.14));
  border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.20);padding:4px;display:flex;flex-direction:column}
.dshatc-item{appearance:none;border:0;background:transparent;text-align:left;
  color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;padding:8px 11px;border-radius:7px;cursor:pointer}
.dshatc-item:hover{background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12))}
.dshatc-item:disabled{color:var(--dsw-alias-label-secondary,#9aa0a6);cursor:default}
.dshatc-item:disabled:hover{background:transparent}
.dshatc-err{color:var(--dsw-alias-state-error-primary,#d33);font-size:12px;padding:4px 10px;max-width:260px;line-height:1.4}
`;

    function utf8ToBase64(text) {
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }

    function chipLabel(text) {
      const flat = String(text).replace(/\s+/g, ' ').trim();
      return flat.length > 6 ? flat.slice(0, 6) + '…' : flat;
    }

    return {
      inject: ['slots', 'remote', 'remote.commands'],
      apply(ctx) {
        const getCommands = () => {
          try {
            if (typeof ctx.get === 'function') {
              const c = ctx.get('remote.commands');
              if (c) return c;
            }
          } catch (e) {
            /* ignore */
          }
          try {
            const r = ctx.get ? ctx.get('remote') : ctx.remote;
            if (r && r.commands) return r.commands;
          } catch (e) {
            /* ignore */
          }
          return undefined;
        };

        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-add-to-chat';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => {
            try {
              style.remove();
            } catch (e) {
              /* ignore */
            }
          };
        });

        function Chips(props) {
          const sessionId = props.sessionId;
          const [items, setItems] = React.useState([]);
          const useInput = props.useInput;
          const useSession = props.useSession;
          const phase =
            typeof useInput === 'function'
              ? useInput((s) => (s ? s.phase : undefined))
              : undefined;
          const running =
            typeof useSession === 'function'
              ? useSession((s) => (s ? s.running : false))
              : false;
          const prevRunning = React.useRef(false);

          // After a message is sent (composer enters a submit phase, or the
          // agent transitions idle -> running), the staged chips have done
          // their job and disappear.
          React.useEffect(() => {
            if (phase && phase !== 'plain') setItems([]);
          }, [phase]);
          React.useEffect(() => {
            if (running && !prevRunning.current) setItems([]);
            prevRunning.current = running;
          }, [running]);

          React.useEffect(() => {
            bridge.sessionId = sessionId;
            bridge.stage = async (text) => {
              const commands = getCommands();
              if (!commands || typeof commands.execute !== 'function') throw new Error('remote.commands unavailable');
              const id = 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
              const resc = await commands.execute(
                sessionId,
                '/dshquote add ' + id + ' ' + utf8ToBase64(text),
                [],
              );
              if (!resc || resc.ok === false) {
                throw new Error((resc && resc.error && resc.error.message) || 'command failed');
              }
              if (resc.value === undefined) {
                throw new Error('command dshquote not found on host');
              }
              setItems((prev) => prev.concat([{ id, text }]));
            };
            bridge.remove = async (id) => {
              const commands = getCommands();
              try {
                if (commands && typeof commands.execute === 'function') {
                  await commands.execute(sessionId, '/dshquote remove ' + id, []);
                }
              } catch (e) {
                /* ignore */
              }
            };
            return () => {
              if (bridge.sessionId === sessionId) {
                bridge.sessionId = null;
                bridge.stage = null;
                bridge.remove = null;
              }
            };
          }, [sessionId]);

          React.useEffect(() => {
            function onContextMenu(e) {
              try {
                const sel = window.getSelection();
                const text = sel ? String(sel).trim() : '';
                if (!text) return;
                const t = e.target;
                if (
                  t &&
                  typeof t.closest === 'function' &&
                  t.closest('[contenteditable="true"],[contenteditable=""],input,textarea')
                ) {
                  return;
                }
                e.preventDefault();
                bridge.setMenu({ x: e.clientX, y: e.clientY, text });
              } catch (err) {
                /* ignore */
              }
            }
            document.addEventListener('contextmenu', onContextMenu);
            return () => document.removeEventListener('contextmenu', onContextMenu);
          }, []);

          if (!items.length) return null;
          return h(
            'div',
            { className: 'dshatc-chips' },
            items.map((it) =>
              h(
                'span',
                { key: it.id, className: 'dshatc-chip', title: it.text },
                h('span', { className: 'dshatc-chip-label' }, chipLabel(it.text)),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshatc-chip-x',
                    'aria-label': '移除引用',
                    title: '移除引用',
                    onClick: () => {
                      setItems((prev) => prev.filter((x) => x.id !== it.id));
                      if (bridge.remove) bridge.remove(it.id);
                    },
                  },
                  '\u00d7',
                ),
              ),
            ),
          );
        }

        function Menu() {
          const [menu, setMenu] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [err, setErr] = React.useState(null);
          const ref = React.useRef(null);

          React.useEffect(() => bridge.subscribe((m) => setMenu(m)), []);

          React.useEffect(() => {
            if (menu) setErr(null);
          }, [menu]);

          React.useEffect(() => {
            if (!menu) return undefined;
            function onDown(e) {
              const t = e.target;
              if (t && typeof t.closest === 'function' && t.closest('.dshatc-menu')) return;
              bridge.setMenu(null);
            }
            function onKey(e) {
              if (e.key === 'Escape') bridge.setMenu(null);
            }
            function onScroll() {
              bridge.setMenu(null);
            }
            function onBlur() {
              bridge.setMenu(null);
            }
            window.addEventListener('mousedown', onDown, true);
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('scroll', onScroll, true);
            window.addEventListener('blur', onBlur);
            return () => {
              window.removeEventListener('mousedown', onDown, true);
              window.removeEventListener('keydown', onKey, true);
              window.removeEventListener('scroll', onScroll, true);
              window.removeEventListener('blur', onBlur);
            };
          }, [menu]);

          if (!menu) return null;

          const copy = () => {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(menu.text);
              }
            } catch (e) {
              /* ignore */
            }
            bridge.setMenu(null);
          };

          const add = async () => {
            if (busy) return;
            if (!bridge.stage) {
              setErr('输入框未就绪，请刷新页面后重试');
              return;
            }
            setBusy(true);
            setErr(null);
            try {
              await bridge.stage(menu.text);
              setBusy(false);
              bridge.setMenu(null);
            } catch (e) {
              setBusy(false);
              setErr((e && e.message) || String(e));
              /* eslint-disable-next-line no-console */
              console.error('[add-to-chat] stage failed', e);
            }
          };

          const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
          const left = Math.max(8, Math.min(menu.x, vw - 176));
          const top = Math.max(8, Math.min(menu.y, vh - 96));

          return h(
            'div',
            {
              ref,
              className: 'dshatc-menu',
              style: { left: left + 'px', top: top + 'px' },
              onMouseDown: (e) => e.stopPropagation(),
            },
            h('button', { type: 'button', className: 'dshatc-item', onClick: copy }, '复制'),
            h(
              'button',
              { type: 'button', className: 'dshatc-item', disabled: busy, onClick: add },
              busy ? '加入中…' : '加入对话',
            ),
            err ? h('div', { className: 'dshatc-err' }, err) : null,
          );
        }

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'add-to-chat-chips', order: 5 },
            Chips,
          ),
        );

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'add-to-chat-menu', order: 60 },
            Menu,
          ),
        );
      },
    };
  },
});
