from pydantic import BaseModel

from app.modules.qa.schemas import QuestionListItemResponse, TagResponse


class CourseActiveUser(BaseModel):
    user_id: int
    username: str
    activity_count: int


class CourseAggregates(BaseModel):
    hot_questions: list[QuestionListItemResponse]
    frequent_questions: list[QuestionListItemResponse]
    tags: list[TagResponse]
    active_users: list[CourseActiveUser]
