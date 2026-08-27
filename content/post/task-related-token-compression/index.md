---
title: "Task-related Token Compression in Multi-modal Large Language Models from an Explainability Perspective"
description: 从可解释性视角出发做任务相关的多模态 Token 压缩。
date: 2026-08-26T08:36:00+08:00
slug: task-related-token-compression
categories:
    - VLM
tags:
    - 论文解读
    - Token压缩
    - 可解释性
    - 多模态
series:
    - 论文解读
math: true
comments: false
---
<div style="background-color:#f9f9f9; padding:8px; border-radius:6px;">
    <b>个人评价</b>:很有意思的一篇文章，出发点是发现了一种较好的可解释性的剪枝方法，但是剪枝决策需要在推理完成后得到，因此通过加入可学习模块的方式进行改良。
</div>

现有的MLLMs通常将视觉token和文本token一起输入到LLM中进行跨模态对齐和整合。然而，这种方法由于视觉token数量庞大（尤其是处理高分辨率图像或高帧率视频时），导致了巨大的内存和计算开销。因此，迫切需要有效的token压缩技术来提高模型的效率。

基于此，论文作者提出了一种可解释性Token剪枝方法:

我们假设MLLMs一共有L层，并将生成的文本token序列记为:
$$
Y=\{y_0,y_1,\dots,y_{T-1}\}
$$
具体而言，我们从最终生成的token来回溯原始视觉输入的贡献。对于第t个生成步骤中的每个$y_t$，首先将相关性图$R_t$初始化为单位矩阵，然后在各层之间迭代更新。

记$A_t^l,\nabla A_t^l$分别为第l层中的Multi-Head Attention Map以及对应的梯度，它们分别在前向反向传播中获取。那么$R_t$的迭代方式如下:
$$
R_t = R_t + E_h((A_t^l\odot \nabla A_t^l)^+)\cdot R_t \tag{1}
$$
其中，$\odot$ 表示Hadamard积，$E_h$表示沿注意力头维度取平均。该更新从第0层一直进行到最后一层。

最终，可以通过索引$R_t$最后一行中相应位置来提取$y_t$与视觉信号之间的相关性，即:
$$
R_t[-1,N_s:N_s+N_v]
$$
最后，我们对所有时间步 t的视觉相关性取平均，从而得到相对于当前响应的整体视觉相关性分数：
$$
R_v\in \mathbb{R}^{1\times N_v}
$$
接下来可以根据

下面对式(1)进行简单的理论解释:

该式来源于**Generic Attention Explainability, GAE** 框架。这是一个用于解释Transformer架构预测结果的强大方法。

GAE之所以选择将Attention Map和其梯度的Hadamard积是因为:

1. Attention Map可以反映每个token从其他token接受了多少注意力
2. 梯度可以反映哪些 token 需要获得更多注意力，才能有效影响当前输出

从数学上我们有:

对某一层、第 h 个注意力头来说，注意力矩阵可以写成：
$$
A_h^l \in \mathbb{R}^{N\times N}
$$


我们把输出分数$s_t$看作是注意力矩阵的函数:
$$
s_t = f(A_h^l)
$$
假设我们对某个注意力权重$A_{h,ij}^l$做一个小扰动，根据一阶泰勒展开我们有:
$$
\Delta s_t \approx \frac{\partial s_t}{\partial A_{h,ij}^l}\Delta A_{h,ij}^l
$$
而在剪枝场景中，扰动量就是其本身，那么我们就可以把贡献写作:
$$
A_{h,ij}^l\odot \nabla A_{h,ij}^l
$$
这就是式子(1)中采用Hadamard积的原因。

实验表明，使用这种方法作为剪枝依据，可以在仅保留50%视觉Token的情况下，保留99%的性能

然而在实际应用中却存在一个局限，$R_v$是输出已经生成后得到的，这与我们进行剪枝的初衷相违背。为了解决这一限制，作者提出了一个独立于MLLM训练的单独模块来近似$R_v$。

整体而言，模型架构如下：

在式子(1)中，我们的相关性图是通过聚合Attention Map得到的，这表明从Attention Map到相关性图的映射是有前景的。

作者通过实验发现仅对第一层注意力应用一个简单的卷积网络就足够了。形式上，令$A^0$表示第一层Attention Map，因为我们是对视觉Token进行剪枝，我们更加关心文本token对于视觉Token的注意力，因此，我们取其子图:$A_{u\to v}^0\in \mathbb{R}^{N_{u}\times N_v}$

随后，我们对每个视觉token的$N_v$个分数取平均，得到一个紧凑表示$A_v^0 \in \mathbb{R}^{1\times N_v}$

该平均注意力向量$A_v^0$随后被输入到一个一维卷积模型$f_{\theta}$中，用于预测视觉相关性:
$$
\hat R_{v} = f_{\theta}(A_v^0)
$$
训练时，我们将真实计算出来的$R_v$处理成为$R_v^*$来作为GT：首先按照上面介绍的方法，屏蔽掉最低的50%的数值，然后将剩余部分归一化为概率分布。作者为了避免原始分数接近，softmax 产生近似均匀的数值，而采用将每个分数除以总和来进行归一化。

最后给定$R_v^*,\hat R_v$，通过KL散度来计算Loss。
