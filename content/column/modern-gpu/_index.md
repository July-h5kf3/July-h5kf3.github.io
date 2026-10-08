---
title: 现代GPU编程指南
# 原「面向Hopper架构CUDA编程」系列；旧地址跳转到这里。
aliases:
  - /column/面向hopper架构cuda编程/
  - /column/面向hopper架构cuda编程/page/1/
menu:
  main:
    name: 现代GPU编程指南
    weight: 8
    params:
      icon: cpu
description: "现代 GPU 的 kernel 编程笔记：从 GPU 硬件架构讲起，围绕 Thread Block Cluster、TMA、Tensor Core（WGMMA）、异步流水线与 FP8 等新特性，最后落到 GEMM / FlashAttention 这类真实算子。"

# Same landing page as 编译原理 (layouts/_partials/column/syllabus.html),
# single track: posts ordered by `weight`, then date.
syllabus:
  references:
    - name: Modern GPU Programming for MLSys
      url: https://github.com/mlc-ai/modern-gpu-programming-for-mlsys
      kind: mlc-ai · 面向机器学习系统的现代 GPU 编程
    - name: 面向 NVIDIA H100 的 CUDA 编程综合课程
      url: https://www.bilibili.com/video/BV1Jgu26sE9j
      kind: Bilibili · 视频课程
---

本系列参考的学习资料：

{{< column-refs >}}
