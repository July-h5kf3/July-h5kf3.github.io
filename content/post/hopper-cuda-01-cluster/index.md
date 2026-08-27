---
title: "面向 Hopper 架构的 CUDA 编程（一）：Thread Block Cluster 与分布式共享内存"
description: Hopper 新增的 Thread Block Cluster 层级，以及分布式共享内存（DSMEM）的用法与约束。
date: 2026-08-27T09:10:00+08:00
slug: hopper-cuda-01-cluster
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
weight: 2
math: true
comments: false
---

> 本篇整理中，先放提纲。

## 提纲

- 为什么需要 cluster：grid / block 之间的粒度鸿沟
- Cluster 的调度语义（GPC 内相邻 SM、cluster 大小限制）
- 启动方式：`cudaLaunchKernelEx` 与 `__cluster_dims__` / 运行期指定 cluster 维度
- 分布式共享内存（DSMEM）
  - `cluster.map_shared_rank()` 访问同 cluster 其它 block 的 shared memory
  - cluster 级同步：`cluster.sync()` / cluster barrier
- 一个最小例子：cluster 内做一次跨 block 的规约
- 适用场景与坑：占用率、可移植性（回退到无 cluster）
