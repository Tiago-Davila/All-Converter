# ConvertiTodo MCP en red local

Guía de despliegue de All-Converter #111 / T067. Usá una revisión que incluya la
[unidad systemd (T062)](convertitodo-mcp.service) y el
[ejemplo de OpenCode (T063)](../examples/opencode/opencode.json).

## Puertos y conexiones

| Servicio | Dirección por defecto en el servidor | Uso |
|---|---|---|
| ConvertiTodo MCP | `127.0.0.1:8765` | MCP en `/mcp`, subida en `/files` y descarga en `/files/{id}`. Todas las peticiones requieren `Authorization: Bearer <token>`. |
| `llama-server` | `127.0.0.1:8080` (configurado al arrancar) | Inferencia local, con API compatible con OpenAI bajo `/v1`. |

Son procesos independientes: el cliente consulta el modelo en `8080` y llama a las herramientas
en `8765`. La unidad de ConvertiTodo no arranca el modelo. Si lo ejecutás en el mismo servidor:

```bash
llama-server -m /ruta/al/modelo.gguf --host 127.0.0.1 --port 8080 --alias convertitodo-local --jinja
```

Usá un modelo y una plantilla de chat compatibles con llamadas a herramientas. El alias
`convertitodo-local` coincide con el del ejemplo de OpenCode.

## Instalar como servicio en Linux

Necesitás systemd, git, uv y un Python 3.12 instalado para todo el sistema, accesible a la cuenta
del servicio. Los ejemplos usan `/usr/bin/python3.12`. Ejecutá `git` y `uv` con tu cuenta de
despliegue; la cuenta de servicio solo necesita leer el checkout y ejecutar su `.venv`.

Para una instalación nueva, creá el usuario y el grupo de sistema `convertitodo-mcp`, sin acceso
interactivo, y prepará el checkout:

```bash
sudo groupadd --system convertitodo-mcp
sudo useradd --system --gid convertitodo-mcp --no-create-home --shell /usr/sbin/nologin convertitodo-mcp
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0755 /opt/convertitodo
umask 022
git clone --branch develop https://github.com/Tiago-Davila/All-Converter.git /opt/convertitodo/All-Converter
cd /opt/convertitodo/All-Converter/mcp
uv sync --locked --python /usr/bin/python3.12
```

Creá el archivo de entorno solo si todavía no existe. Debe quedar bajo `root:root` con modo
`0600`. Generá un token aleatorio en una terminal privada con
`/usr/bin/python3.12 -c 'import secrets; print(secrets.token_urlsafe(32))'` y guardalo en ese
archivo usando `sudoedit`:

```bash
sudo install -d -o root -g root -m 0750 /etc/convertitodo-mcp
sudo test -e /etc/convertitodo-mcp/environment || sudo install -o root -g root -m 0600 /dev/null /etc/convertitodo-mcp/environment
sudo chown root:root /etc/convertitodo-mcp/environment
sudo chmod 0600 /etc/convertitodo-mcp/environment
sudoedit /etc/convertitodo-mcp/environment
```

```ini
CONVERTITODO_MCP_TOKEN=
```

Pegá el token después de `=` (mínimo 16 caracteres) y dejá la asignación sin `export`. No guardes
el valor real en Git ni lo pases como argumento del servicio. systemd lee el archivo como root y
le pasa la variable al proceso.

Desde `/opt/convertitodo/All-Converter/mcp`, instalá y habilitá la unidad:

```bash
sudo install -o root -g root -m 0644 deploy/convertitodo-mcp.service /etc/systemd/system/convertitodo-mcp.service
sudo systemctl daemon-reload
sudo systemctl enable --now convertitodo-mcp.service
sudo systemctl status convertitodo-mcp.service
```

La unidad inicia `/opt/convertitodo/All-Converter/mcp/.venv/bin/convertitodo-mcp` en HTTP sobre
`127.0.0.1:8765`. Con `StateDirectory=convertitodo-mcp`, systemd crea
`/var/lib/convertitodo-mcp` para la cuenta del servicio; ahí quedan `uploads/` y `outputs/`, sujetos
al [borrado por TTL](../README.md#borrado-automático). Si no arranca, revisá
`sudo journalctl -u convertitodo-mcp.service -n 50 --no-pager`.

## Acceder desde otra máquina

### Recomendado: túnel SSH desde el cliente

Dejá ambos servicios en loopback. Desde el equipo cliente, abrí un túnel (el segundo `-L` hace
falta solo si `llama-server` también corre en el servidor remoto):

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8765:127.0.0.1:8765 \
  -L 127.0.0.1:8080:127.0.0.1:8080 usuario@servidor-lan
```

Mientras la sesión está abierta, usá `http://127.0.0.1:8765/mcp` y, si reenviás el modelo,
`http://127.0.0.1:8080/v1` desde el cliente. Si ya hay un puerto local ocupado, cambiá el puerto
del lado izquierdo del reenvío y actualizá la URL del cliente. El túnel cifra el tráfico sin abrir
los puertos `8765` y `8080` en el firewall; el MCP sigue exigiendo su token.

### Alternativa: acceso HTTP directo solo en una LAN confiable

HTTP directo no cifra el token, los documentos ni los resultados. Antes de cambiar la escucha,
configurá el firewall del servidor para permitir TCP `8765` solo desde las IP de los clientes
autorizados o la subred LAN confiable, y bloquear el resto. Aplicá la misma restricción a TCP `8080`
solo si los clientes necesitan llegar directamente al modelo. No publiques estos puertos en
Internet ni configures reenvíos en el router.

La unidad restringe el tráfico a loopback y fija `--host` en la línea de arranque. Para permitir
acceso directo, ejecutá `sudo systemctl edit convertitodo-mcp.service` y agregá este override.
Reemplazá `192.168.1.10` por la IP LAN del servidor y `192.168.1.20/32` por la IP o subred
permitida en el firewall:

```ini
[Service]
IPAddressAllow=192.168.1.20/32
ExecStart=
ExecStart=/opt/convertitodo/All-Converter/mcp/.venv/bin/convertitodo-mcp --transporte http --host 192.168.1.10 --puerto 8765
```

`IPAddressAllow` agrega la excepción LAN a la de loopback de la unidad. Reiniciá con
`sudo systemctl restart convertitodo-mcp.service` y usá `http://192.168.1.10:8765/mcp` desde los
clientes autorizados. Si también abrís el modelo en la LAN, configurá `llama-server --host` con
su IP LAN y ajustá la URL del modelo en el cliente.

## Configurar los clientes

**OpenCode.** Adaptá el [ejemplo `opencode.json`](../examples/opencode/opencode.json) en tu
configuración privada. Usá la URL de `/mcp` accesible desde OpenCode y apuntá el proveedor local
a la URL `/v1` del modelo. El ejemplo lee `CONVERTITODO_MCP_TOKEN` del entorno del cliente para
armar la cabecera Bearer: cargá el valor vigente antes de iniciar OpenCode, sin grabarlo en el JSON.
Probá la conexión con `convertitodo_ping`; debe devolver `estado: ok`.

### Fork de la UI de llama.cpp

Usá una compilación del [fork `Tiago-Davila/llama.cpp`](https://github.com/Tiago-Davila/llama.cpp)
que incluya T064–T066. Para autorizar ese navegador, agregá al archivo de entorno del servicio:

```ini
CONVERTITODO_MCP_ORIGEN_UI=http://127.0.0.1:8080
```

Reemplazá el valor por el origen exacto que muestra el navegador (esquema, host y puerto, sin
barra final). Reiniciá el servicio. Sin esta variable, el MCP no habilita CORS.

1. En **MCP Servers**, agregá y habilitá el servidor con URL `http://127.0.0.1:8765/mcp` (o la
   URL accesible desde el navegador). Agregá `Authorization` en **Custom Headers**, con valor
   `Bearer <token>`. Dejá desactivado el proxy CORS de la UI. Usá un perfil de navegador privado
   para guardar la configuración y mantené el mismo esquema HTTP(S) en ambos servicios.
2. En `+` → **Adjuntar a ConvertiTodo**, elegí el servidor y subí el archivo. El modelo recibe
   su ID y su nombre. Pedile que use el adjunto y aprobá las llamadas de herramienta que correspondan.
3. Si la herramienta genera archivos, usá **Descargar** en cada tarjeta del chat antes de que venza
   el TTL.

## Rotar el token

1. Generá un token aleatorio nuevo y coordiná el cambio con quienes usan el servicio. Editá
   `/etc/convertitodo-mcp/environment` con `sudoedit` y reemplazá `CONVERTITODO_MCP_TOKEN`.
2. Ejecutá `sudo systemctl restart convertitodo-mcp.service` para cargar el valor nuevo. El
   servicio acepta un solo token: desde el reinicio, el anterior devuelve `401`.
3. Actualizá el secreto o la cabecera Bearer en **todos** los clientes, incluido el fork de la UI.
   En OpenCode, cerrá el proceso y volvé a iniciarlo con el nuevo valor en
   su entorno. Verificá `ping` con el token nuevo y comprobá que el anterior recibe `401`.
   Compartí el valor nuevo solo por un canal privado.

## Actualizar el servicio

Detené el servicio con `sudo systemctl stop convertitodo-mcp.service` y, con la cuenta de
despliegue, actualizá el checkout a la revisión aprobada.
Desde `mcp/`, repetí `uv sync --locked --python /usr/bin/python3.12`. Si cambió la unidad, volvé a
instalarla y ejecutá `sudo systemctl daemon-reload`. Arrancá el servicio con
`sudo systemctl start convertitodo-mcp.service` y comprobá `ping` desde un cliente. Conservá el
archivo de entorno y el directorio de estado entre actualizaciones.
