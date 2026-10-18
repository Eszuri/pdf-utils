from dataclasses import dataclass, field

Box = tuple[float, float, float, float]


@dataclass
class Span:
    text: str
    bbox: Box
    origin: tuple[float, float]
    font: str
    size: float
    flags: int
    char_flags: int
    color: int
    glyphs: list[tuple[str, Box, tuple[float, float]]] = field(default_factory=list)


@dataclass
class Line:
    spans: list[Span]
    bbox: Box
    direction: tuple[float, float] = (1.0, 0.0)
    heading_level: int | None = None


@dataclass
class Cell:
    row: int
    col: int
    rows: int
    cols: int
    bbox: Box
    lines: list[Line] = field(default_factory=list)
    fill: str | None = None


@dataclass
class Table:
    bbox: Box
    xs: list[float]
    ys: list[float]
    cells: list[Cell]
    border_color: str = '808080'
    border_width: float = .5


@dataclass
class Picture:
    bbox: Box
    data: bytes
    svg: bytes | None = None


@dataclass
class Page:
    number: int
    width: float
    height: float
    lines: list[Line]
    tables: list[Table]
    pictures: list[Picture]
    source_text: str
    warnings: list[str] = field(default_factory=list)
    background: Picture | None = None
    removed_markdown: str = ''
    markdown_headings: int = 0
