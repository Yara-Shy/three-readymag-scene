# Flowfield Particles для Readymag

Готова анімація на `<canvas>`, яку можна швидко викласти на **GitHub Pages** та вставити в **Readymag** через Embed.

## Локальний запуск

Відкрий `index.html` у браузері.

> Якщо потрібна панель налаштувань (dat.GUI), додай параметр `?gui=1` до URL.

## Як захостити на GitHub Pages

1. Створи новий репозиторій на GitHub.
2. Завантаж цей проєкт у репозиторій.
3. На GitHub зайди в **Settings → Pages**.
4. У блоці **Build and deployment** обери:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` (або `master`), folder `/ (root)`
5. Натисни **Save**.
6. Через 1–2 хвилини отримаєш публічне посилання виду:
   - `https://<username>.github.io/<repo-name>/`

## Як вставити в Readymag

1. У Readymag додай **Code / Embed widget**.
2. Встав iframe:

```html
<iframe
  src="https://<username>.github.io/<repo-name>/"
  style="width:100%; height:100%; border:0;"
  allowfullscreen
></iframe>
```

### Корисно для продакшну

- Без панелі налаштувань (рекомендовано для публікації):
  - `https://<username>.github.io/<repo-name>/`
- З панеллю dat.GUI (для тюнінгу):
  - `https://<username>.github.io/<repo-name>/?gui=1`
