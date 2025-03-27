# ローレンツプロット計算方法

## 手順

1. 現在の心拍間隔を $x$ 軸上の座標，次の心拍間隔を $y$ 軸上の座標としてプロットする．
2. 上記のプロットを，$y=x$ 軸($x'$ 軸)と $y=-x$ 軸($y'$ 軸)からなる直交座標に変換する．
3. $y=x$ 軸上における原点からの長さの平均を，指標 `distance` とする．IoTスイッチとしてはこちらの値を基に作動させる．
4. $y=x$ 軸上における原点からの長さの標準偏差 $\sigma_x$ ，$y=-x$ 軸上における原点からの長さの標準偏差 $\sigma_{-x}$ を軸とする楕円の面積を，指標 `area` とする．

将来的には，`distance` `area` どちらもトリガーとして扱えることを想定．

## 座標変換

$x$ 軸， $y$ 軸，$y=x$ 軸 ($x'$ 軸)，$y=-x$ 軸 ($y'$ 軸)方向の単位ベクトルを $\vec{e_x}$，$\vec{e_y}$，$\vec{e_{x'}}$，$\vec{e_{y'}}$ とする．

座標軸は 45° そのまま回転させているため，

$$
\begin{align*}
\vec{e_{x'}} &= \cos 45\degree \vec{e_{x}} + \sin 45\degree \vec{e_{y}} \\
\vec{e_{x'}} &= \frac{1}{\sqrt{2}} \vec{e_{x}} + \frac{1}{\sqrt{2}} \vec{e_{y}} \\
\vec{e_{y'}} &= \cos (90\degree + 45\degree) \vec{e_{x}} + \sin (90\degree + 45\degree) \vec{e_{y}} \\
\vec{e_{y'}} &= -\frac{1}{\sqrt{2}} \vec{e_{x}} + \frac{1}{\sqrt{2}} \vec{e_{y}} 
\end{align*}
$$

$x$-$y$ 座標系に対する $x'$-$y'$ 座標系の回転行列 $\bm{R}$ は

$$
\begin{align*}
\bm{R} &= 
\begin{bmatrix}
\bm{e_{x'}} & \bm{e_{y'}}
\end{bmatrix} =
\begin{bmatrix}
\frac{1}{\sqrt{2}} & -\frac{1}{\sqrt{2}} \\
\frac{1}{\sqrt{2}} & \frac{1}{\sqrt{2}}
\end{bmatrix}
\end{align*}
$$

ここで任意の点に向けたベクトル $\vec{a}$ を定義する．

$$
\begin{align*}
\vec{a} &= a_x \vec{e_{x}} + a_y \vec{e_{y}} = a_{x'} \vec{e_{x'}} + a_{y'} \vec{e_{y'}}
\end{align*}
$$

よって，

$$
\begin{align*}
\bm{a'} &= \bm{R}^T \bm{a} \\
\begin{bmatrix}
a_{x'} \\
a_{y'}
\end{bmatrix}
&=
\begin{bmatrix}
\frac{1}{\sqrt{2}} & \frac{1}{\sqrt{2}} \\
-\frac{1}{\sqrt{2}} & \frac{1}{\sqrt{2}}
\end{bmatrix}
\begin{bmatrix}
a_x \\
a_y
\end{bmatrix} \\
\begin{bmatrix}
a_{x'} \\
a_{y'}
\end{bmatrix}
&=
\begin{bmatrix}
\frac{1}{\sqrt{2}}(a_x + a_y) \\
\frac{1}{\sqrt{2}}(-a_x + a_y)
\end{bmatrix}
\end{align*}
$$


## 参考文献

1. [豊福 史](https://www.jstage.jst.go.jp/search/global/_search/-char/ja?item=8&word=%E8%B1%8A%E7%A6%8F+%E5%8F%B2), [山口 和彦](https://www.jstage.jst.go.jp/search/global/_search/-char/ja?item=8&word=%E5%B1%B1%E5%8F%A3+%E5%92%8C%E5%BD%A6), [萩原 啓](https://www.jstage.jst.go.jp/search/global/_search/-char/ja?item=8&word=%E8%90%A9%E5%8E%9F+%E5%95%93), 心電図RR間隔のローレンツプロットによる副交感神経活動の簡易推定法の開発, 人間工学, 43 巻, 4 号, p.185-192 , 2007.<br>https://www.jstage.jst.go.jp/article/jje1965/43/4/43_4_185/_article/-char/ja/