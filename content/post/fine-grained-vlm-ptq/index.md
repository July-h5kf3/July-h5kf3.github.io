---
title: "Fine-Grained Post-Training Quantization for Large Vision Language Models with Quantization-Aware Integrated Gradients"
description: 用量化感知的积分梯度做细粒度的视觉语言模型训练后量化。
date: 2026-08-26T08:24:00+08:00
slug: fine-grained-vlm-ptq
categories:
    - VLM
tags:
    - 论文解读
    - VLM
    - PTQ
    - 积分梯度
series:
    - 论文解读
math: true
comments: false
---
<div style="background-color:#f9f9f9; padding:8px; border-radius:6px;">
    <b>个人评价</b>:比较有意思的研究思路，从MBQ的Modality-Specific出发，通过实验发现，相较于Modality-Specific，更加细粒度的Token-Wise进行区分效果会更好。基于此研究了多种Token敏感度估计方法，最终采用基于公理化归因的积分梯度方法进行规约，取得不错的效果。但是问题在于文章对理论的分析严重不足！
</div>

假设你阅读过MBQ，它是按照模态去对优化目标进行加权的，那么我们可以仔细想想，不同模态最终都会以Token的形式输入模型，既然不同模态之间存在对量化噪声敏感性差异，那么我们其实可以说本质上是Token内部就存在差异，这个差异不仅仅存在于不同模态之间，还可能存在同一个模态之中。那么也就是说，我们完全可以仿照MBQ的思路去做更加细粒度的加权。

一般而言，衡量这种Token之间的差异，可以通过敏感性估计进行。作者在文章中尝试了三种敏感性估计方式:

- 基于梯度:和MBQ一致，依据Token关于量化损失的梯度
- 基于注意力:用Attention Score
- 基于扰动:人为扰动token，然后观察block输出变化有多大。

注:实验方法大概是像MBQ一样对不同的Token对量化损失进行加权，然后在VizWiz数据集上进行测试。

最后结果表明，Token-Level的扰动法的效果在不同敏感度估计下表现最优(0.36%的微弱优势)

基于上述分析，我们知道，按Token的细粒度量化方法可能会有更好的效果。因此作者声称基于公理化归因的启发。下面简单介绍一下公理化归因，这个方法来源于可解释AI。

我们从经典的积分梯度（IG）出发。IG用来衡量从参考输入x'到真实输入x的真实路径上，每个Token的累积贡献，其中$f(\cdot,\cdot)$表示该Block的输出：
$$
\text{IG}(x) = (x - x')\int_{0}^{1}\frac{\partial f(x^\alpha ,w)}{\partial x^{\alpha}}d\alpha \tag{QIG 1}
$$
其中$x^\alpha = \alpha(x-x')$,而$f(\cdot,w)$表示全精度模型。

我简单介绍一下这个是怎么来的吧，本质上我们是想知道某个输入的Token发生变化后会对模型的输出产生怎样的变化。由导数的定义我们知道:
$$
f(x)-f(x') = \int_{x'}^x\frac{\partial f(t)}{\partial t}dt
$$
在一维的情况下，因为只有一个变量，因此我们上式就是该Token的归约。当我们将输入扩展到多维，我们自然想知道每个维度对变化的贡献。

IG的做法是，我们从参考输入x‘出发，沿一条直线走到真实输入x，可以将这条路径写作:
$$
x^\alpha = x' + \alpha(x - x'),\quad \alpha \in [0,1]
$$
那么此时，我们可以把函数写作按照路径变化的形式:
$$
F(\alpha) = f(x^\alpha)
$$
这是一个一维函数，自变量只有$\alpha$，于是输入变化带来的变化可以写作:
$$
f(x)-f(x') = F(1)-F(0)
$$
写作积分形式:
$$
F(1)-F(0) = \int_0^1 \frac{dF(\alpha)}{d\alpha}d\alpha = \int_{0}^1 \frac{\partial f(x^\alpha)}{\partial x^\alpha}\cdot \frac{\partial x^\alpha}{\partial \alpha}
$$
而:
$$
x_i^\alpha = x_i' + \alpha(x_i-x_i')
$$
故:
$$
\frac{\partial x_i^\alpha}{\partial \alpha} = x_i-x_i'
$$
代入有：
$$
\frac{dF(\alpha)}{d\alpha} = \sum_{i=1}^n \frac{\partial f(x^\alpha)}{\partial x^\alpha}(x_i-x_i')
$$
因此:
$$
f(x)-f(x') = \int_{0}^1 \sum_{i=1}^n\frac{\partial f(x^\alpha)}{\partial x^\alpha}(x_i-x_i') d\alpha = \sum_{i=1}^n (x_i-x_i')\int_{0}^1 \frac{\partial f(x^\alpha)}{\partial x^\alpha}d\alpha
$$
那么IG就定义第i维的规约为:
$$
\text{IG}_i(x) = (x_i-x_i')\int_{0}^1 \frac{\partial f(x^\alpha)}{\partial x^\alpha}d\alpha
$$
写作向量形式就是式子QIG(1)中的形式。

对应到量化场景，我们取原始输入$x'$为量化后的输入$x'=x^q$,那么可以写出量化感知积分梯度:
$$
\text{QIG} = (x-x_q)\int_{0}^1 \frac{\partial f(x^\alpha)}{\partial x^\alpha}d\alpha
$$
不过我们不能直接将QIG作为优化的权，因为它呈现了重尾分布，这会导致极少部分token主导优化过程。为了抑制这种现象，作者选择按照四分位距(IQR)进行裁剪，从而得到裁剪后的分数:
$$
C(QIG_i) = clip(QIG_i,Q_1-1.5\cdot IQR,Q_3+1.5\cdot IQR)
$$
其中$Q_1,Q_3$分别表示第一和第三四分位数，且$IQR=Q_3-Q_1$.随后对这些分数进行归一化，得到最终的token重要系数:
$$
\lambda_i = \frac{C(QIG_i)}{\sum C(QIG_i)}
$$
之后按照类似于MBQ的思路，将这个加权融入量化优化的目标函数即可。
