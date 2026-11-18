# OpenCode con llama-server y ConvertiTodo MCP

Ejemplo para OpenCode V2 ([#111 / T063](https://github.com/Tiago-Davila/All-Converter/issues/111)).
OpenCode, llama-server y ConvertiTodo MCP se ejecutan en la misma máquina. El ejemplo
solo habilita `llama-local` para la inferencia; no requiere una cuenta ni una API externa.

1. Arranca llama-server con un archivo GGUF local y una plantilla de chat compatible
   con llamadas a herramientas:

   ```sh
   llama-server -m "/ruta/a/modelo.gguf" --host 127.0.0.1 --port 8080 --alias convertitodo-local --jinja
   ```

   `convertitodo-local` es el alias que llama-server publica en `GET /v1/models`. Debe
   coincidir con la clave en `providers.llama-local.models` y con el sufijo del modelo
   `llama-local/convertitodo-local` en OpenCode.

2. Exporta el mismo `CONVERTITODO_MCP_TOKEN` (mínimo 16 caracteres) en las terminales
   que arrancarán ConvertiTodo MCP y OpenCode. Consulta la
   [guía del servidor](../../README.md#cómo-arrancarlo) para generar el token y preparar
   el MCP. Con las dependencias ya disponibles, arranca el servidor desde la raíz del repo:

   ```sh
   uv run --directory mcp --no-sync convertitodo-mcp --transporte http --host 127.0.0.1 --puerto 8765
   ```

   OpenCode sustituye `{env:CONVERTITODO_MCP_TOKEN}` en la cabecera `Authorization`
   para conectar a `/mcp` por Streamable HTTP. No guardes el valor real en el JSON.

3. Desde la raíz del repo, en la terminal de OpenCode:

   ```sh
   cd mcp/examples/opencode
   opencode --standalone
   ```

   OpenCode carga el `opencode.json` de esa carpeta. En `/mcps`, comprueba que
   `convertitodo` figure conectado y pídele al modelo que ejecute `convertitodo_ping`;
   la herramienta debe devolver `estado: ok`. Si cambias la configuración o el token,
   cierra y vuelve a iniciar OpenCode para que lea los cambios.
