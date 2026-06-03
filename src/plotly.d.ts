// plotly.js-dist-min は型定義を同梱しないため簡易 ambient 宣言を使用
declare module 'plotly.js-dist-min' {
  const Plotly: {
    newPlot(el: string | HTMLElement, data: object[], layout?: object, config?: object): Promise<HTMLElement>;
    react(el: string | HTMLElement, data: object[], layout?: object): Promise<HTMLElement>;
    relayout(el: string | HTMLElement, update: object): Promise<HTMLElement>;
  };
  export default Plotly;
}

// Plotly はプロット要素に .on / ._fullLayout を生やすため、その型を補強
interface HTMLElement {
  on?(event: string, handler: (data: any) => void): void;
  _fullLayout?: any;
}
