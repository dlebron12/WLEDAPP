# Theme options (not decided yet)

Three ways to restyle the app with the Light Ops palette. **None of these is applied to the app.**
They are kept here until a permanent choice is made.

## Palette

| Color | Hex |
|---|---|
| Darkest navy | `#1a1a2e` |
| Dark navy | `#16213e` |
| Blue | `#0f3460` |
| Gold | `#efc07b` |
| White | `#FFFFFF` |

Each option has a **light** and a **dark** version; the app follows the phone/computer's
light or dark setting. Light versions use pale tints of the palette for backgrounds.
In all three, the light preview stays a night scene (`#1a1a2e` background, unlit lights in
`#0f3460`), and gold is never used for small text on white (too hard to read).

## The options

| | Option A: Midnight & Gold | Option B: Blue Hour | Option C: Gold Statement |
|---|---|---|---|
| Idea | Navy layers, gold for actions | Blue `#0f3460` leads, gold as highlight | Gold-forward, navy header bar in both modes |
| Dark | `#1a1a2e` background, `#16213e` cards, gold buttons | `#16213e` background, `#0f3460` cards, `#1a1a2e` header, gold buttons | `#1a1a2e` background, `#16213e` cards with thin gold borders, gold buttons |
| Light | Warm off-white background, navy buttons, gold tab underline | Pale blue background, `#0f3460` header and buttons | Cream background, navy header, gold buttons with navy text, gold strip on cards |
| Stylesheet | [option-a.css](option-a.css) | [option-b.css](option-b.css) | [option-c.css](option-c.css) |
| Screenshots | [option-a.png](option-a.png) | [option-b.png](option-b.png) | [option-c.png](option-c.png) |

Each screenshot shows, at phone size: sign-in page (light), Controls tab (light), sign-in page
(dark), Controls tab (dark).

![Option A](option-a.png)
![Option B](option-b.png)
![Option C](option-c.png)

## Applying one later

Each `option-*.css` only overrides the app's color variables and a few rules, so it is applied by
loading it **after** `public/styles.css`. To try one locally without changing anything permanent:

1. Copy it into the app: `cp design/theme-options/option-a.css public/theme.css`
2. In `public/index.html` and `public/home.html`, add after the `styles.css` line:
   `<link rel="stylesheet" href="/theme.css">`

To make the choice permanent, fold the chosen file's values into the `:root` color variables at
the top of `public/styles.css` (and its dark-mode block), so there is one stylesheet.
