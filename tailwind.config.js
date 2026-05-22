function v(name) {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

function palette(prefix, shades) {
  const out = { DEFAULT: v(`${prefix}-500`) };
  for (const s of shades) out[s] = v(`${prefix}-${s}`);
  return out;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces (appearance-aware)
        canvas: v('canvas'),
        surface: v('surface'),
        'surface-sub': v('surface-sub'),
        'surface-hover': v('surface-hover'),
        // Lines
        line: v('line'),
        'line-strong': v('line-strong'),
        // Text
        ink: {
          1: v('ink-1'),
          2: v('ink-2'),
          3: v('ink-3'),
          4: v('ink-4'),
          5: v('ink-5')
        },
        // Brand (theme-aware — claude vs codex)
        brand: palette('brand', [50, 100, 200, 500, 600, 700]),
        // Semantic (appearance-aware)
        info: palette('info', [50, 100, 500, 600]),
        warn: palette('warn', [50, 100, 500, 600]),
        danger: palette('danger', [50, 100, 500, 600]),
        agent: palette('agent', [50, 100, 500, 600]),
        think: palette('think', [50, 100, 500])
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Microsoft YaHei',
          'Roboto',
          'sans-serif'
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        pop: 'var(--shadow-pop)'
      },
      borderRadius: {
        xl2: '14px'
      }
    }
  },
  plugins: []
};
