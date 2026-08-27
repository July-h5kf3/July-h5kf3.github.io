---
title: "面向 Hopper 架构的 CUDA 编程（开篇）：新特性总览"
description: 梳理 Hopper（H100/H800，sm_90）为 CUDA 编程带来的关键新特性，并给出本系列的整体规划。
date: 2026-08-27T09:00:00+08:00
slug: hopper-cuda-00-intro
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
weight: 1
math: true
comments: false
---

这是「面向 Hopper 架构的 CUDA 编程」系列的开篇。之所以想单独开一个系列，是因为 Hopper（H100 / H800，计算能力 `sm_90`）相比 Ampere 并不只是"更大更快"，而是引入了一批**需要改变编程范式**才能吃满的新硬件特性。本篇先做一个总览，后续每篇再展开一个专题，并尽量用 GEMM / FlashAttention 这类真实算子把它们串起来。

## Hopper 带来了什么

### 1. Thread Block Cluster 与分布式共享内存（DSMEM）

Hopper 在 grid → block 之间新增了一层 **Thread Block Cluster**。同一个 cluster 内的若干 block 会被调度到同一个 GPC 内的相邻 SM 上，从而可以：

- 通过 **分布式共享内存（Distributed Shared Memory）** 直接读写同 cluster 内其它 block 的 shared memory；
- 使用 **cluster 级别的同步原语**（cluster barrier）。

这让"比一个 block 更大、又比走 global memory 更快"的协作成为可能，对 tiling 策略的设计影响很大。

### 2. TMA：Tensor Memory Accelerator

TMA 是一个**专用的异步批量拷贝引擎**，负责 global memory 与 shared memory 之间的多维 tile 搬运。它的价值在于：

- 用一个 **copy descriptor** 描述多维张量的搬运，一条指令搬一整块，不再需要大量线程手写地址计算；
- 天然异步，把访存和计算重叠起来，同时**省下寄存器和线程**去做真正的计算。

### 3. WGMMA：warpgroup 级异步 Tensor Core

Hopper 的 Tensor Core 通过 **WGMMA（warpgroup MMA）** 以 **warpgroup（128 线程）** 为粒度、以**异步**方式发射矩阵乘累加，并原生支持 **FP8（e4m3 / e5m2）**。相比 Ampere 的 `mma`，它的吞吐更高，也更依赖异步流水线来喂数据。

### 4. 异步事务屏障（mbarrier）与流水线

要把 TMA 的异步搬运和 WGMMA 的异步计算真正重叠起来，就需要 **异步事务屏障（mbarrier / async transaction barrier）** 来构建生产者–消费者流水线：一边 TMA 往 shared memory 里灌数据、累加 transaction count，另一边 WGMMA 等待到齐后开算。

### 5. 其它值得关注的点

- **FP8 与 Transformer Engine**：配合 WGMMA 的 FP8，训练/推理里低精度 GEMM 成为一等公民；
- **`setmaxnreg`**：warpgroup 之间可以**动态重新分配寄存器**，让"搬运 warpgroup"少占、"计算 warpgroup"多占；
- **更大的 shared memory**（每 SM 可配置到约 228KB）与 **DPX** 指令（加速动态规划类算子）。

## 本系列规划

后续计划按下面的顺序展开（会随写随调）：

1. Thread Block Cluster 与分布式共享内存
2. TMA 异步数据搬运
3. WGMMA 与异步 Tensor Core
4. 用 mbarrier 构建生产者–消费者流水线
5. FP8 与 Transformer Engine 实战

最后会用一个**从 naive 到 Hopper-optimized 的 GEMM / FlashAttention** 案例，把上面这些特性组合起来，看看它们各自贡献了多少性能。

> 本篇为系列总览，具体的代码与实验会放在后续各篇。
