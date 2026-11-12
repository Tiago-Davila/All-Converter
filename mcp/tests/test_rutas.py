"""Pruebas del bloqueo de path traversal, el saneado de nombres y la validación de ids."""

from __future__ import annotations

import secrets
import tempfile
from pathlib import Path

import pytest

from convertitodo_mcp.errores import ErrorArgumento, ErrorRutaInsegura
from convertitodo_mcp.storage.rutas import (
    LARGO_MAXIMO_NOMBRE,
    asegurar_dentro,
    es_id_valido,
    resolver_dentro,
    sanear_nombre,
    validar_id,
)


# Comprueba si el sistema permite crear symlinks.
def _soporta_symlinks() -> bool:
    with tempfile.TemporaryDirectory() as carpeta:
        raiz = Path(carpeta)
        (raiz / "a").write_text("x")
        try:
            (raiz / "b").symlink_to(raiz / "a")
        except (OSError, NotImplementedError):
            return False
    return True


requiere_symlinks = pytest.mark.skipif(
    not _soporta_symlinks(), reason="el sistema no soporta symlinks"
)


@pytest.fixture
def base(tmp_path: Path) -> Path:
    carpeta = tmp_path / "base"
    carpeta.mkdir()
    return carpeta


@pytest.fixture
def afuera(tmp_path: Path) -> Path:
    carpeta = tmp_path / "afuera"
    carpeta.mkdir()
    (carpeta / "secreto.txt").write_text("secreto")
    return carpeta


# Un archivo simple se resuelve dentro de la base aunque no exista.
def test_resolver_archivo_simple(base: Path) -> None:
    assert resolver_dentro(base, "a.txt") == base.resolve() / "a.txt"


# Una subcarpeta se resuelve dentro de la base.
def test_resolver_subcarpeta(base: Path) -> None:
    assert resolver_dentro(base, "sub/a.txt") == base.resolve() / "sub" / "a.txt"


# Acepta nombres con tildes y espacios y rutas de tipo Path.
def test_resolver_nombre_con_tildes_y_espacios(base: Path) -> None:
    esperado = base.resolve() / "informe año 2024.pdf"
    assert resolver_dentro(base, "informe año 2024.pdf") == esperado
    assert resolver_dentro(base, Path("informe año 2024.pdf")) == esperado


# Un archivo existente real se acepta.
def test_resolver_archivo_existente(base: Path) -> None:
    (base / "ok.txt").write_text("hola")
    assert resolver_dentro(base, "ok.txt").read_text() == "hola"


@pytest.mark.parametrize(
    "relativa",
    [
        "../x",
        "a/../../x",
        "..",
        "a/..",
        "/etc/passwd",
        "C:\\Windows",
        "C:/Windows",
        "C:foo",
        "\\\\srv\\share",
        "a\\..\\b",
        "a\\b",
        "",
        "   ",
        ".",
        "a\x00b",
        "\x00",
    ],
)
# Las rutas maliciosas o malformadas se rechazan.
def test_resolver_rechaza_rutas_inseguras(base: Path, relativa: str) -> None:
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, relativa)


# El mensaje de error no filtra rutas absolutas del servidor.
def test_mensaje_no_incluye_rutas_del_servidor(base: Path) -> None:
    with pytest.raises(ErrorRutaInsegura) as info:
        resolver_dentro(base, "../x")
    assert str(base) not in str(info.value)
    assert str(base.parent) not in str(info.value)


@requiere_symlinks
# Un symlink a un archivo de afuera se rechaza.
def test_symlink_a_archivo_externo(base: Path, afuera: Path) -> None:
    (base / "enlace").symlink_to(afuera / "secreto.txt")
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, "enlace")


@requiere_symlinks
# Un symlink a un directorio de afuera se rechaza, también al atravesarlo.
def test_symlink_a_directorio_externo(base: Path, afuera: Path) -> None:
    (base / "carpeta").symlink_to(afuera, target_is_directory=True)
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, "carpeta")
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, "carpeta/secreto.txt")


@requiere_symlinks
# Un symlink a un archivo de adentro también se rechaza.
def test_symlink_a_archivo_interno(base: Path) -> None:
    (base / "real.txt").write_text("x")
    (base / "alias").symlink_to(base / "real.txt")
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, "alias")


@requiere_symlinks
# Un symlink en un componente intermedio se rechaza aunque apunte adentro.
def test_symlink_en_componente_intermedio(base: Path) -> None:
    (base / "real").mkdir()
    (base / "real" / "a.txt").write_text("x")
    (base / "atajo").symlink_to(base / "real", target_is_directory=True)
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, "atajo/a.txt")


@requiere_symlinks
# Un symlink roto también se rechaza.
def test_symlink_roto(base: Path) -> None:
    (base / "roto").symlink_to(base / "no_existe")
    with pytest.raises(ErrorRutaInsegura):
        resolver_dentro(base, "roto")


@requiere_symlinks
# Si la base es accesible por un symlink, se resuelve y funciona.
def test_base_accesible_por_symlink(tmp_path: Path, base: Path) -> None:
    enlace = tmp_path / "enlace_base"
    enlace.symlink_to(base, target_is_directory=True)
    (base / "a.txt").write_text("x")
    resultado = resolver_dentro(enlace, "a.txt")
    assert resultado == base.resolve() / "a.txt"
    assert asegurar_dentro(enlace, enlace / "a.txt") == base.resolve() / "a.txt"


# asegurar_dentro acepta rutas de adentro y relativas a la base.
def test_asegurar_dentro_valida(base: Path) -> None:
    (base / "a.txt").write_text("x")
    esperado = base.resolve() / "a.txt"
    assert asegurar_dentro(base, base / "a.txt") == esperado
    assert asegurar_dentro(base, Path("a.txt")) == esperado


# asegurar_dentro rechaza rutas de afuera y con '..'.
def test_asegurar_dentro_rechaza_afuera(base: Path, afuera: Path) -> None:
    with pytest.raises(ErrorRutaInsegura):
        asegurar_dentro(base, afuera / "secreto.txt")
    with pytest.raises(ErrorRutaInsegura):
        asegurar_dentro(base, base / ".." / "afuera" / "secreto.txt")
    with pytest.raises(ErrorRutaInsegura):
        asegurar_dentro(base, Path("/etc/passwd"))


@requiere_symlinks
# asegurar_dentro rechaza symlinks en el tramo dentro de la base.
def test_asegurar_dentro_rechaza_symlinks(base: Path, afuera: Path) -> None:
    (base / "carpeta").symlink_to(afuera, target_is_directory=True)
    with pytest.raises(ErrorRutaInsegura):
        asegurar_dentro(base, base / "carpeta" / "secreto.txt")


_CASOS_SANEAR: list[tuple[str, str]] = [
    ("informe.pdf", "informe.pdf"),
    ("../../etc/passwd", "passwd"),
    ("C:\\a\\b.txt", "b.txt"),
    ("a\\b/c.txt", "c.txt"),
    (".env", "env"),
    ("...", "archivo"),
    ("..", "archivo"),
    ("a/b/..", "archivo"),
    ("", "archivo"),
    ("   ", "archivo"),
    ("\x00", "archivo"),
    ("CON.txt", "_CON.txt"),
    ("nul", "_nul"),
    ("COM1.log", "_COM1.log"),
    ("COM10.txt", "COM10.txt"),
    ("Console.txt", "Console.txt"),
    ("informe año 2024.pdf", "informe año 2024.pdf"),
    ("cafe\u0301.txt", "caf\u00e9.txt"),
    ("a\x00b\x01c\x7f.txt", "abc.txt"),
    ('a<b>c:d"e|f?g*h.txt', "a_b_c_d_e_f_g_h.txt"),
    ("  .oculto. ", "oculto"),
    ("foo/", "foo"),
    ("archivo.txt ", "archivo.txt"),
    ("final...", "final"),
    ("ñandú señor.docx", "ñandú señor.docx"),
]


@pytest.mark.parametrize(("entrada", "esperado"), _CASOS_SANEAR)
# El saneado produce el nombre esperado.
def test_sanear_nombre_tabla(entrada: str, esperado: str) -> None:
    assert sanear_nombre(entrada) == esperado


# Un nombre de 300 caracteres se recorta conservando la extensión.
def test_sanear_nombre_largo_conserva_extension() -> None:
    resultado = sanear_nombre("x" * 300 + ".pdf")
    assert len(resultado) == LARGO_MAXIMO_NOMBRE
    assert resultado.endswith(".pdf")
    assert resultado.startswith("x" * 100)


# Un nombre largo con extensión absurda igual queda dentro del límite.
def test_sanear_nombre_extension_enorme() -> None:
    resultado = sanear_nombre("a." + "b" * 300)
    assert 0 < len(resultado) <= LARGO_MAXIMO_NOMBRE


# Todas las entradas de la tabla producen un nombre seguro.
def test_sanear_nombre_propiedad_general() -> None:
    entradas = [e for e, _ in _CASOS_SANEAR] + ["x" * 300 + ".pdf", "é" * 500, "a." + "b" * 300]
    for entrada in entradas:
        resultado = sanear_nombre(entrada)
        assert resultado
        assert "/" not in resultado
        assert "\\" not in resultado
        assert "\x00" not in resultado
        assert not resultado.startswith(".")
        assert len(resultado) <= LARGO_MAXIMO_NOMBRE


# Un token_urlsafe real es un id válido.
def test_id_real_es_valido() -> None:
    identificador = secrets.token_urlsafe(16)
    assert es_id_valido(identificador)
    assert validar_id(identificador) == identificador


@pytest.mark.parametrize(
    "identificador",
    [
        "../x",
        "",
        "a/b" + "c" * 20,
        "con espacios " + "c" * 20,
        "corto",
        "a" * 65,
        "é" * 20,
        "a" * 20 + "\n",
    ],
)
# Los ids malformados no son válidos y validar_id lanza ErrorArgumento.
def test_ids_invalidos(identificador: str) -> None:
    assert not es_id_valido(identificador)
    with pytest.raises(ErrorArgumento):
        validar_id(identificador)


# El mensaje de validar_id no repite el valor recibido.
def test_validar_id_no_repite_valor() -> None:
    with pytest.raises(ErrorArgumento) as info:
        validar_id("../../secreto")
    assert "secreto" not in str(info.value)
