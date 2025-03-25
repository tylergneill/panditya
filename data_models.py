from typing import List, Dict, Optional

class Entity:
    ATTRIBUTES: List[str] = ["id", "type", "name", "aka", "highest_year", "lowest_year"]

    def __init__(self, entity_id: str):
        self.id: str = entity_id
        self.type: str = ""
        self.name: str = ""
        self.aka: str = ""
        self.highest_year: Optional[int] = None
        self.lowest_year: Optional[int] = None

    def __str__(self) -> str:
        fields = vars(self)
        return "\n".join(f"{key}: {value}" for key, value in fields.items())

    @classmethod
    def from_dict(cls, data: Dict) -> "Entity":
        # This generic method only works if you're instantiating the exact class.
        instance = cls(data["id"])
        for attr in cls.ATTRIBUTES:
            if attr in data:
                setattr(instance, attr, data[attr])
        return instance

    @staticmethod
    def create_from_dict(data: Dict) -> "Entity":
        t = data.get("type", "").lower()
        if t == "work":
            return Work.from_dict(data)
        elif t == "author":
            return Author.from_dict(data)
        else:
            raise ValueError(f"Unknown entity type: {t}")

    def to_dict(self) -> Dict:
        return {attr: getattr(self, attr) for attr in self.ATTRIBUTES if getattr(self, attr) is not None}


class Work(Entity):
    ATTRIBUTES: List[str] = Entity.ATTRIBUTES + [
        "author_ids", "base_text_ids", "commentary_ids",
        "discipline", "author_highest_year", "author_lowest_year"
    ]

    def __init__(self, entity_id: str):
        super().__init__(entity_id)
        self.type: str = "work"
        self.author_ids: List[str] = []
        self.base_text_ids: List[str] = []
        self.commentary_ids: List[str] = []
        self.discipline: Optional[str] = None
        self.author_highest_year: Optional[int] = None
        self.author_lowest_year: Optional[int] = None

    @classmethod
    def from_dict(cls, data: Dict) -> "Work":
        work = cls(data["id"])
        for attr in cls.ATTRIBUTES:
            if attr in data:
                setattr(work, attr, data[attr])
        return work

    def to_dict(self) -> Dict:
        attrs = {
            **super().to_dict(),
            "author_ids": self.author_ids,
            "base_text_ids": self.base_text_ids,
            "commentary_ids": self.commentary_ids,
            "discipline": self.discipline,
            "author_highest_year": self.author_highest_year,
            "author_lowest_year": self.author_lowest_year,
        }
        return {k: v for k, v in attrs.items() if v is not None}


class Author(Entity):
    ATTRIBUTES: List[str] = Entity.ATTRIBUTES + [
        "social_identifiers", "work_ids", "disciplines"
    ]

    def __init__(self, entity_id: str):
        super().__init__(entity_id)
        self.type: str = "author"
        self.social_identifiers: Optional[str] = None
        self.work_ids: List[str] = []
        self.disciplines: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict) -> "Author":
        author = cls(data["id"])
        for attr in cls.ATTRIBUTES:
            if attr in data:
                setattr(author, attr, data[attr])
        return author

    def to_dict(self) -> Dict:
        attrs = {
            **super().to_dict(),
            "social_identifiers": self.social_identifiers,
            "work_ids": self.work_ids,
            "disciplines": self.disciplines,
        }
        return {k: v for k, v in attrs.items() if v is not None}
