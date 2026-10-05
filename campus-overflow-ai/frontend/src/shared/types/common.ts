// 分页信封：与后端各分页接口的 data 形状一致（items/total/page/page_size，蛇形）
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
