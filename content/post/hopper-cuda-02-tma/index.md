---
title: "面向 Hopper 架构的 CUDA 编程（二）：TMA 异步数据搬运"
description: 用 Tensor Memory Accelerator（TMA）做 global↔shared 的多维 tile 异步搬运。
date: 2026-08-27T09:20:00+08:00
slug: hopper-cuda-02-tma
series:
    - 技术分享
categories:
    - 算子开发
column:
    - 面向Hopper架构CUDA编程
tags:
    - CUDA
    - Hopper
    - GPU
    - 高性能计算
weight: 3
math: true
comments: false
---

> 本篇整理中，先放提纲。

## 提纲

- TMA 解决了什么问题：把地址计算与搬运交给专用引擎
- Copy descriptor（tensor map）的构造：主机侧 `cuTensorMapEncodeTiled`
- 发射一次异步拷贝：`cp.async.bulk.tensor` 与 shared memory 目标
- 与 mbarrier 协同：transaction count 如何统计到齐
- 多维 tile、swizzle 与 bank conflict
- 一个 global→shared 的 tile 搬运最小例子
