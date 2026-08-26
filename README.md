# Lorn

个人笔记空壳，基于 [Hugo](https://gohugo.io/) 和 [Stack](https://github.com/CaiJimmy/hugo-theme-stack)。

线上地址：https://july-h5kf3.github.io/

本机需要 **Hugo Extended** 和 **Go**。若尚未安装，可把二进制放到 `~/.local/bin`（Hugo）和 `~/.local/go`（Go）。

```bash
export PATH="$HOME/.local/go/bin:$HOME/.local/bin:$PATH"
hugo server
```

浏览器打开 http://localhost:1313/

- 改站点标题、语言、侧栏：`config/_default/`
- 写文章：`content/post/`
- 加栏目：在 `content/page/` 新建一页，并写进该页的 `menu.main`

预留了 GitHub Actions → GitHub Pages。上线前把 `config/_default/config.toml` 里的 `baseurl` 改成真实地址，并在仓库 Settings → Pages 把 Source 设为 GitHub Actions。
