# Obsidian-like DB Folder

Extensión de VS Code que replica el plugin **dbfolder** de Obsidian: vistas de base de datos (Tabla, Tablero, Lista, Galería) sobre una carpeta de notas Markdown, usando las propiedades de su frontmatter YAML como columnas.

## Características

- **Detección automática de columnas**: cada propiedad del frontmatter se convierte en una columna, con el tipo inferido (texto, número, checkbox, fecha, select, multi-select).
- **Cuatro vistas**, cambiables desde pestañas: Tabla, Tablero (kanban con arrastrar y soltar), Lista y Galería.
- **Edición inline** de celdas, que escribe de vuelta al frontmatter del fichero `.md` correspondiente.
- Gestión de columnas (añadir, renombrar, eliminar, reordenar), filtros y orden múltiple, por vista.
- **Columnas de fórmula**: motor de expresiones propio (sin `eval`) con funciones tipo `concat`, `if`, operadores aritméticos/lógicos, y acceso a otras propiedades de la fila.
- Configuración (columnas, vistas, filtros...) persistida por carpeta en un fichero `.dbfolder.json` dentro de la propia carpeta.
- Refresco en vivo: un file watcher detecta cambios externos en las notas y actualiza la vista.

## Uso

Clic derecho sobre una carpeta en el Explorador → **"DB Folder: Open Database View"** (también disponible en la paleta de comandos).

## Seguridad

Esta extensión **no realiza ninguna llamada de red saliente**. Auditado explícitamente:

- Sin `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` ni módulos `http`/`https`/`net` de Node, ni en el código fuente ni en el bundle compilado (`dist/extension.js`, `dist/webview.js`).
- Sin telemetría, analítica ni reporting de errores a servicios externos.
- El webview aplica una Content-Security-Policy sin ninguna excepción de red: `default-src 'none'`, con `img-src`/`style-src`/`script-src` restringidos a los recursos empaquetados dentro de la propia extensión (ningún `https:` permitido). Por diseño, la vista Galería no carga imágenes remotas.
- Todas las dependencias de runtime (`gray-matter`, `react`, `react-dom`) resuelven desde el registro oficial de npm; ninguna es una librería de telemetría.
- `gray-matter` parsea el frontmatter YAML usando el loader **seguro** de `js-yaml` (`safeLoad`/`safeDump`), no el inseguro `load`/`dump` — evita la vía de ejecución de código vía la etiqueta `!!js/function`.

## Requisitos

- Una carpeta de notas Markdown con frontmatter YAML.

## Desarrollo

```bash
npm install
npm run watch     # compila en modo watch (extensión + webview)
```

Pulsa **F5** en VS Code para lanzar un Extension Development Host con la extensión cargada.

## Empaquetado

```bash
npm run package   # compila y genera el .vsix
```

Instalación local del `.vsix` generado:

```bash
code --install-extension obsidianlike-dbfolder-0.1.0.vsix --force
```

`--force` es necesario para sustituir una instalación previa de la misma versión: recompilar o empaquetar de nuevo **no** actualiza una copia ya instalada, hay que reinstalar el `.vsix` explícitamente (y recargar la ventana con `Developer: Reload Window`) para probar los cambios.
