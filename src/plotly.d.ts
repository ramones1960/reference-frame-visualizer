// plotly.js-dist-min は型定義を同梱しないため簡易 ambient 宣言を使用
declare module 'plotly.js-dist-min' {
  const Plotly: {
    newPlot(el: string | HTMLElement, data: object[], layout?: object, config?: object): Promise<void>;
    react(el: string | HTMLElement, data: object[], layout?: object): Promise<void>;
  };
  export default Plotly;
}
