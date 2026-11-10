# AsmLens 前端插件

1. 在本目录放一个 `.js` 文件  
2. 写入 `MANIFEST.json` 数组，例如 `["example.js", "my.js"]`  
3. 脚本里调用：

```js
window.AsmLens.registerPlugin({
  name: "my-plugin",
  onRegister(api) {},
  onProjectLoaded(project) {},
  onViewRendered({ chrom, start, end }) {},
});
```

可用 API：`AsmLens.gotoRegion`、`AsmLens.status`、`AsmLens.state`。
