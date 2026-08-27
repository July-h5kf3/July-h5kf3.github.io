---
title: "QAPruner: Quantization-Aware Vision Token Pruning for Multimodal Large Language Models"
description: 量化感知的视觉 Token 剪枝。
date: 2026-08-26T08:30:00+08:00
slug: qapruner
categories:
    - VLM
tags:
    - 论文解读
    - QAPruner
    - 视觉Token剪枝
    - VLM
series:
    - 论文解读
math: true
comments: false
---
<div style="background-color:#f9f9f9; padding:8px; border-radius:6px;">
    <b>个人评价</b>:方法特别简单，就是在剪枝的时候考虑量化的影响
</div>

当我们简单地将基于语义的token剪枝应用于经PTQ优化的模型时，会丢弃对数值稳定性至关重要的激活异常值，从而在低比特位制度（如W4A4）下显著加剧量化误差。

论文提出的解决思路是提出一种量化感知的视觉Token剪枝方法QAPruner，具体而言，方法如下：

我们考虑构建一个联合考虑语义相关性和量化鲁棒性的Token选择机制。

对于每个视觉token，$v_i \in \mathbb{R}^{D}$，我们通过融合两个互相正交的指标来计算其敏感度:分组量化模拟和全局异常值强度。

在目前主流的PTQ量化方法中，通常会将激活值重新分组为若干个更小的组，以便计算局部缩放因子，从而减轻通道异常值的影响。为了模拟这个过程，我们将token特征重排为$M = D / G$个组，其中第i个token的第m组记为$v_{i,m}\in\mathbb{R}^{G}$。假设采用INT4量化，则局部缩放因子$s_{i,m}$及其量化后的表示$\hat{v_{i,m}}$可以写作：
$$
s_{i,m} = \frac{\max(|v_{i,m}|)}{7}\\
\hat{v_{i,m}} = \text{Round}(\frac{v_{i,m}}{s_{i,m}+\epsilon})\cdot s_{i,m}
$$
随后将所有的$v_{i,m}$进行拼接得到$\hat{v_i}\in \mathbb{R}^{D}$。那么第i个Token的分组量化误差记为:$E_i$:
$$
E_i = ||v_i - \hat{v_i}||_2^2
$$
具有较高$E_i $的 token 在局部层面上本质上更难量化，并会遭受显著的信息损失，因此是应当优先保留的关键候选。

尽管上述指标$E_i$可以捕获局部量化困难，但是它可能无法显式惩罚那些包含极端全局异常值的token被移除的情况。这类携带异常值的token决定了整个张量的最大激活范围，对于保持大语言模型的涌现特性至关重要。

为了显式保护这些结构性异常值，我们将第 i 个 token 的**全局异常值强度** $R_i$定义为其在全部 D 个通道上的激活值跨度：
$$
R_i = \max_{j\in\{1,\dots,D\}}(v_{i,j})-\min_{j\in\{1,\dots,D\}}(v_{i,j})
$$
较大的 $R_i$ 表明该 token 中存在严重的激活异常值，因此一旦被丢弃，就会对量化后的数值分布造成更大的扰动。

为了构建一个能够兼顾局部细节保留和全局异常值保护的综合度量，我们首先在一个 batch 内，对 N个视觉 token 的这两个指标分别独立归一化到 [0,1] 区间。最终的量化敏感度分数 $S_i^Q$定义为两项归一化指标的等权和：
$$
S_i^Q = \frac{1}{2}\cdot \frac{E_i - \min(E)}{\max(E)-\min(E)} + \frac{1}{2}\cdot \frac{R_i -\min(R)}{\max(R)-\min(R)}
$$
最后，我们将这一量化敏感度与传统的视觉token剪枝方法得到的分数$S_i^P$结合起来，共同指导token的选择过程。为此，我们引入了超参数$\alpha \in [0,1]$,用于控制语义对齐和数值稳定性之间的权衡：
$$
S_i^{Final} = \alpha S_i^P + (1-\alpha)S_i^Q
$$
通过这种方法重新校准了 token 选择准则，使得剪枝后的视觉序列不仅在语义上对查询保持足够的信息性，同时也能更好地抵抗低比特 PTQ 所带来的性能退化。
