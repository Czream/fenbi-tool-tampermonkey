# fenbi-tool-tampermonkey

# 一个简单的粉笔题库解析复盘增强的油猴脚本

这是一个油猴脚本，用于粉笔网解析复盘页面的功能增强，主要提供优化布局、评论区展示和用时统计等功能。

## 功能特性

- ✅ 优化页面布局
- ✅ 自动为每道题目添加评论区，可展开查看优质评论
- ✅ 专项练习模式：按每 5 题一组统计用时
- ✅ 试卷模式：按模块统计各模块总用时
- ✅ 自定义范围用时统计：输入起始和结束题号，计算总用时
- ✅ 支持一键展开/收起所有解析和评论区

## 安装方法

1. 首先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展（支持 Chrome、Edge、Firefox 等）
2. 点击下方链接直接安装脚本：  
   [点击安装脚本](https://raw.githubusercontent.com/Czream/fenbi-tool-tampermonkey/main/fenbi-tool.user.js)
3. 或手动安装：下载本仓库中的 `fenbi-tool.user.js` 文件，然后在 Tampermonkey 管理面板中导入

## 使用说明

- 打开粉笔网（`https://*.fenbi.com/*`）的题目解析或复盘页面
- 页面右上角会出现控制按钮：
  - “全部展开/收起” ：控制所有解析和评论区的展开状态
  - “⏱ 用时统计” ：查看分组用时或模块用时
  - “📋 每题用时” ：查看每道题的详细用时
- 点击相应按钮即可使用

## 反馈与支持

如果你在使用中遇到问题或有建议，请在 [GitHub Issues](https://github.com/Czream/fenbi-tool-tampermonkey/issues) 中提交反馈。

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可。
