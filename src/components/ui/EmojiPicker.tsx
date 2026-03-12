import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import styles from './EmojiPicker.module.css';

const CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  {
    name: 'Smileys',
    icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
      '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫',
      '🤔','🫣','🤐','🤨','😐','😑','😶','🫥','😏','😒',
      '🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
      '🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳',
      '🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯',
      '😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢',
      '😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤',
      '😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹',
      '👺','👻','👽','👾','🤖',
    ],
  },
  {
    name: 'Gestures',
    icon: '👋',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
      '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
      '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
      '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾',
    ],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟',
      '♥️','🫀','💋','💌','💐','🌹','🌺','🌸','🌷','🌻',
    ],
  },
  {
    name: 'Animals',
    icon: '🐶',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨',
      '🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒',
      '🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗',
      '🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰',
    ],
  },
  {
    name: 'Food',
    icon: '🍔',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐',
      '🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑',
      '🫛','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄',
      '🧅','🥔','🍠','🫘','🥐','🥖','🍞','🧀','🥚','🍳',
      '🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕',
      '🫔','🌮','🌯','🫕','🥗','🍝','🍜','🍲','🍛','🍣',
    ],
  },
  {
    name: 'Objects',
    icon: '⚽',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱',
      '🪀','🏓','🏸','🏒','🥅','⛳','🏹','🎣','🤿','🥊',
      '🎮','🕹️','🎲','🧩','♟️','🎯','🎳','🎭','🎨','🎬',
      '🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸',
      '🎻','🪕','💻','⌨️','🖥️','📱','📷','📹','🎥','📞',
    ],
  },
  {
    name: 'Symbols',
    icon: '🔥',
    emojis: [
      '🔥','⭐','🌟','✨','⚡','💥','💫','🎉','🎊','🏆',
      '🏅','🥇','🥈','🥉','🎖️','🏵️','🎗️','✅','❌','⭕',
      '❗','❓','‼️','⁉️','💯','🔴','🟠','🟡','🟢','🔵',
      '🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻',
    ],
  },
];

const RECENT_KEY = 'h2v_recent_emojis';
const MAX_RECENT = 32;

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker(props: Props) {
  const [activeCategory, setActiveCategory] = createSignal(0);
  const [search, setSearch] = createSignal('');
  const [recent, setRecent] = createSignal<string[]>([]);
  let panelRef: HTMLDivElement | undefined;

  onMount(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) setRecent(JSON.parse(stored));
    } catch { /* ignore */ }

    const handleClick = (e: MouseEvent) => {
      if (panelRef && !panelRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    onCleanup(() => document.removeEventListener('mousedown', handleClick));
  });

  function selectEmoji(emoji: string) {
    props.onSelect(emoji);

    const updated = [emoji, ...recent().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    setRecent(updated);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch { /* */ }
  }

  const filteredEmojis = () => {
    const q = search().toLowerCase();
    if (!q) return null;
    const all: string[] = [];
    for (const cat of CATEGORIES) {
      all.push(...cat.emojis);
    }
    return all;
  };

  return (
    <div ref={panelRef} class={styles.picker}>
      <div class={styles.header}>
        <input
          class={styles.search}
          placeholder="🔍"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          autofocus
        />
        <button class={styles.closeBtn} onClick={props.onClose}>✕</button>
      </div>

      <Show when={!search()}>
        <div class={styles.tabs}>
          <Show when={recent().length > 0}>
            <button
              class={`${styles.tab} ${activeCategory() === -1 ? styles.tabActive : ''}`}
              onClick={() => setActiveCategory(-1)}
              title="Recent"
            >🕐</button>
          </Show>
          <For each={CATEGORIES}>
            {(cat, i) => (
              <button
                class={`${styles.tab} ${activeCategory() === i() ? styles.tabActive : ''}`}
                onClick={() => setActiveCategory(i())}
                title={cat.name}
              >{cat.icon}</button>
            )}
          </For>
        </div>
      </Show>

      <div class={styles.grid}>
        <Show when={search()}>
          <For each={filteredEmojis()}>
            {(emoji) => (
              <button class={styles.emoji} onClick={() => selectEmoji(emoji)}>{emoji}</button>
            )}
          </For>
        </Show>

        <Show when={!search() && activeCategory() === -1}>
          <For each={recent()}>
            {(emoji) => (
              <button class={styles.emoji} onClick={() => selectEmoji(emoji)}>{emoji}</button>
            )}
          </For>
        </Show>

        <Show when={!search() && activeCategory() >= 0}>
          <For each={CATEGORIES[activeCategory()]?.emojis ?? []}>
            {(emoji) => (
              <button class={styles.emoji} onClick={() => selectEmoji(emoji)}>{emoji}</button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
