# 🧠 @catmeow/readme-ai

AI-powered **README generator** that analyzes your project and creates professional documentation automatically — powered by **Google Gemini AI** and a hosted API (no setup required).

---

## ✨ Features

- 🚀 **One Command** — Run instantly with `npx`, no API key or setup required  
- 🧩 **Automatic Project Analysis** — Detects languages, dependencies, and project type  
- 🤖 **AI-Powered Generation** — Uses Gemini AI to craft structured, detailed READMEs  
- ⚙️ **Smart Detection** — Works for Node.js, React, Python, and more  
- 💡 **Hosted API** — Uses a free hosted backend with built-in rate limiting  
- 🪶 **No Installation Needed** — Works instantly out of the box  

---

## ⚡️ Quick Start

Generate a README instantly:

```bash
npx @catmeow/readme-ai
```

That’s it!  
Your project will be scanned and a professional **README.md** will be created automatically in your folder.

### 📁 Generate for a specific project directory

```bash
npx @catmeow/readme-ai /path/to/your/project
```

---

## 🧱 What It Does

`@catmeow/readme-ai` automatically:

- Scans your project structure and detects frameworks, dependencies, and languages  
- Analyzes your codebase to understand functionality and structure  
- Generates a full, professional README.md using AI  
- Writes it directly to your project root  

---

## 📊 Example Output

```
🚀 README-AI Generator

Target directory: /Users/meow/my-app
Server: https://readme-ai-backend.onrender.com

🔍 Analyzing project...
✓ Found 52 files
✓ Detected project type: React + Node.js
✓ Languages: TypeScript, JavaScript

🤖 Generating README with AI...

📝 Writing README.md...

✅ README.md created successfully at: /Users/meow/my-app/README.md
```

---

## 🧠 Behind the Scenes

- Uses **Gemini AI** via a hosted backend:  
  [`https://readme-ai-backend.onrender.com`](https://readme-ai-backend.onrender.com)  
- API calls are rate-limited to **10 requests / 15 minutes per IP**  
- No need to provide your own API key  

---

## 💻 Requirements

- Node.js **v18+**
- Internet connection (for API access)

---

## 🧰 Development (For Contributors)

Build the project:

```bash
npm run build
or 
pnpm run build
``` 

Run the CLI locally:

```bash
npm run dev
```

Start the backend server:

```bash
pnpm run start:server
```

---

## 🪪 License

**MIT License** — free for personal and commercial use.

---

## 🤝 Contributing

Contributions, ideas, and pull requests are welcome!  
If you’d like to improve the project or report an issue, open a PR or issue on **GitHub**.

---

## 🌐 Maintained by

**[@catmeow 🐾](https://npmjs.com/~catmeow)** — bringing simple dev tools to life.
