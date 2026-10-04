// 声誉类型：字段与后端 interaction/schemas.py 完全一致（蛇形）
// 注意：RankItem 只有 user_id / username / score，没有名次字段，名次由前端按顺序计算
export interface RankRow {
  user_id: number;
  username: string;
  score: number;
}

export type RankPeriod = "week" | "month" | "all";
