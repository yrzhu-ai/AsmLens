# 操作记录 2026-11-07 — Utafun GenomeSyn2（module）

## 用户指令
不要改环境配置；在 base 用模块加载 GenomeSyn2。

## 改了什么
- 运行脚本改为仅 `module load GenomeSyn2`（不再 `conda activate`、不改写 PATH、不改任何 env 配置）
- 停掉此前错误启动的同目录作业后重跑
- 染色体：去掉 ref 的 Scaffold11，保留 Chr01–Chr10，与 query 数量/顺序一致

## 没改什么
- 未修改 conda/module/环境配置文件
- 未改原始 `utafun_v3.fa` / `ref1m.fa`
- 未动其他作业（如 Abaca 覆盖度）

## 当前
- 输出：`/share/home/yrzhu/20260914/Utafun_v1x/genomesyn2_utafun_v3_vs_ref1m/`
- 日志：`…/logs/wrapper_20261107_110753.log`
- 状态：minimap2 asm5 比对进行中（16 线程）
