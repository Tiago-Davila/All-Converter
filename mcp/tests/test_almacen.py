"""Tests del almacén de carpetas de trabajo con ids opacos."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from convertitodo_mcp.errores import ErrorArchivoNoEncontrado, ErrorArgumento
from convertitodo_mcp.storage import Almacen
from convertitodo_mcp.storage.rutas import es_id_valido


# Almacén listo para usar sobre una carpeta temporal.
@pytest.fixture
def almacen(tmp_path: Path) -> Almacen:
    return Almacen(tmp_path / "trabajo")


# Devuelve los permisos (bits bajos) de una ruta.
def _permisos(ruta: Path) -> int:
    return stat.S_IMODE(ruta.stat().st_mode)


# El constructor no toca el disco.
def test_constructor_no_toca_el_disco(tmp_path: Path) -> None:
    Almacen(tmp_path / "trabajo")
    assert not (tmp_path / "trabajo").exists()


# preparar crea las carpetas con 0o700 y es idempotente.
def test_preparar_crea_carpetas_con_permisos(almacen: Almacen, tmp_path: Path) -> None:
    almacen.preparar()
    almacen.preparar()
    base = tmp_path / "trabajo"
    for carpeta in (base, base / "uploads", base / "outputs"):
        assert carpeta.is_dir()
        assert _permisos(carpeta) == 0o700


# Guardar y leer da los mismos bytes en ambas zonas.
def test_guardar_y_leer_ida_y_vuelta(almacen: Almacen) -> None:
    subida = almacen.guardar_subida("a.txt", b"hola")
    salida = almacen.guardar_salida("b.txt", b"chau")
    assert subida.zona == "uploads"
    assert salida.zona == "outputs"
    assert almacen.leer(subida.id) == b"hola"
    assert almacen.leer(salida.id) == b"chau"
    assert subida.tamano == 4
    assert subida.nombre == "a.txt"
    assert subida.creado.tzinfo is not None
    assert subida.ruta.is_absolute()
    assert subida.ruta.parent.name == subida.id


# El id es válido y dos guardados del mismo nombre no se pisan.
def test_ids_distintos_para_el_mismo_nombre(almacen: Almacen) -> None:
    uno = almacen.guardar_subida("igual.txt", b"1")
    dos = almacen.guardar_subida("igual.txt", b"2")
    assert es_id_valido(uno.id)
    assert es_id_valido(dos.id)
    assert uno.id != dos.id
    assert almacen.leer(uno.id) == b"1"
    assert almacen.leer(dos.id) == b"2"


# Los nombres hostiles quedan saneados y dentro de la zona.
@pytest.mark.parametrize(
    "hostil", ["../../etc/passwd", "C:\\x\\y.pdf", "", "mal\x00nombre.txt", "..", "a/../b"]
)
def test_nombres_hostiles_quedan_dentro(almacen: Almacen, tmp_path: Path, hostil: str) -> None:
    guardado = almacen.guardar_subida(hostil, b"x")
    zona = (tmp_path / "trabajo" / "uploads").resolve()
    assert guardado.ruta.resolve().is_relative_to(zona)
    assert guardado.ruta.parent.parent == zona
    assert "/" not in guardado.nombre
    assert "\\" not in guardado.nombre
    assert "\x00" not in guardado.nombre
    assert guardado.nombre
    assert almacen.leer(guardado.id) == b"x"


# Ejemplos concretos del saneado de nombres.
def test_nombres_saneados_concretos(almacen: Almacen) -> None:
    assert almacen.guardar_subida("../../etc/passwd", b"x").nombre == "passwd"
    assert almacen.guardar_subida("C:\\x\\y.pdf", b"x").nombre == "y.pdf"


# Un id inexistente lanza ErrorArchivoNoEncontrado.
def test_obtener_id_inexistente(almacen: Almacen) -> None:
    with pytest.raises(ErrorArchivoNoEncontrado):
        almacen.obtener("A" * 22)


# Un id con formato inválido lanza ErrorArgumento.
def test_obtener_id_invalido(almacen: Almacen) -> None:
    with pytest.raises(ErrorArgumento):
        almacen.obtener("../x")


# Una carpeta de id vacía se trata como inexistente.
def test_obtener_carpeta_vacia(almacen: Almacen, tmp_path: Path) -> None:
    almacen.preparar()
    identificador = "B" * 22
    (tmp_path / "trabajo" / "uploads" / identificador).mkdir()
    with pytest.raises(ErrorArchivoNoEncontrado):
        almacen.obtener(identificador)


# Un symlink plantado en la carpeta del id se trata como inexistente.
def test_symlink_dentro_de_la_carpeta_es_inexistente(almacen: Almacen, tmp_path: Path) -> None:
    secreto = tmp_path / "secreto.txt"
    secreto.write_bytes(b"confidencial")
    almacen.preparar()
    identificador = "C" * 22
    carpeta = tmp_path / "trabajo" / "uploads" / identificador
    carpeta.mkdir()
    (carpeta / "enlace.txt").symlink_to(secreto)
    with pytest.raises(ErrorArchivoNoEncontrado):
        almacen.obtener(identificador)
    with pytest.raises(ErrorArchivoNoEncontrado):
        almacen.leer(identificador)


# Algo que no es un archivo regular dentro de la carpeta se trata como inexistente.
def test_directorio_dentro_de_la_carpeta_es_inexistente(almacen: Almacen, tmp_path: Path) -> None:
    almacen.preparar()
    identificador = "D" * 22
    carpeta = tmp_path / "trabajo" / "outputs" / identificador
    (carpeta / "subcarpeta").mkdir(parents=True)
    with pytest.raises(ErrorArchivoNoEncontrado):
        almacen.obtener(identificador)


# reservar_salida, escribir en la ruta y obtener devuelve el tamaño real.
def test_reservar_salida_y_obtener(almacen: Almacen) -> None:
    reserva = almacen.reservar_salida("informe.pdf")
    assert reserva.tamano == 0
    assert reserva.zona == "outputs"
    assert es_id_valido(reserva.id)
    assert not reserva.ruta.exists()
    reserva.ruta.write_bytes(b"0123456789")
    obtenido = almacen.obtener(reserva.id)
    assert obtenido.tamano == 10
    assert obtenido.nombre == "informe.pdf"
    assert obtenido.ruta == reserva.ruta


# borrar devuelve True/False y luego obtener falla.
def test_borrar(almacen: Almacen) -> None:
    guardado = almacen.guardar_subida("a.txt", b"x")
    assert almacen.borrar(guardado.id) is True
    assert almacen.borrar(guardado.id) is False
    with pytest.raises(ErrorArchivoNoEncontrado):
        almacen.obtener(guardado.id)
    assert not guardado.ruta.parent.exists()


# listar filtra por zona, ordena por creación e ignora basura.
def test_listar_ordenado_e_ignora_basura(almacen: Almacen, tmp_path: Path) -> None:
    primero = almacen.guardar_subida("a.txt", b"1")
    segundo = almacen.guardar_salida("b.txt", b"2")
    tercero = almacen.guardar_subida("c.txt", b"3")
    for indice, archivo in enumerate((primero, segundo, tercero)):
        os.utime(archivo.ruta, (1_000_000 + indice, 1_000_000 + indice))
    uploads = tmp_path / "trabajo" / "uploads"
    (uploads / "no-es-id").mkdir()
    (uploads / "suelto.txt").write_bytes(b"basura")
    (uploads / ("E" * 22)).mkdir()
    assert [a.id for a in almacen.listar("uploads")] == [primero.id, tercero.id]
    assert [a.id for a in almacen.listar("outputs")] == [segundo.id]
    assert [a.id for a in almacen.listar()] == [primero.id, segundo.id, tercero.id]


# Los archivos se guardan con permisos 0o600 y su carpeta con 0o700.
def test_permisos_de_archivo_y_carpeta(almacen: Almacen) -> None:
    guardado = almacen.guardar_subida("a.txt", b"x")
    assert _permisos(guardado.ruta) == 0o600
    assert _permisos(guardado.ruta.parent) == 0o700


# No quedan temporales a medias tras guardar.
def test_no_quedan_temporales(almacen: Almacen) -> None:
    guardado = almacen.guardar_subida("a.txt", b"x")
    assert [p.name for p in guardado.ruta.parent.iterdir()] == ["a.txt"]


# El mensaje de error no incluye rutas absolutas del servidor.
def test_mensaje_de_error_sin_rutas(almacen: Almacen, tmp_path: Path) -> None:
    with pytest.raises(ErrorArchivoNoEncontrado) as info:
        almacen.obtener("F" * 22)
    assert str(tmp_path) not in str(info.value)
    assert str(tmp_path) not in info.value.mensaje_para_modelo()
