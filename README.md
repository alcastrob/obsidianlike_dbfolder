# Obsidian-like DB Folder

Extensión de VS Code que replica el plugin **dbfolder** de Obsidian ([RafaelGB/obsidian-db-folder](https://github.com/RafaelGB/obsidian-db-folder)): vistas de base de datos (Tabla, Tablero, Lista, Galería) sobre notas Markdown, usando las propiedades de su frontmatter YAML como columnas.

## Dos formas de definir una base de datos

1. **Notas de base de datos reales de Obsidian**: cualquier nota `.md` con un bloque ` ```yaml:dbfolder ` embebido (el formato nativo del plugin) se detecta automáticamente y se abre en la vista de tabla/tablero/lista/galería en lugar de mostrarse como texto plano — igual que en Obsidian. Los cambios se escriben de vuelta al propio bloque de la nota, así que las notas siguen siendo compatibles con el plugin original.
2. **Carpetas sueltas**: clic derecho sobre cualquier carpeta en el Explorador → **"Obsidian like DbFolder: Open Database View"**. La configuración se guarda en un `.dbfolder.json` dentro de esa carpeta.

## Características

- **Detección automática de columnas**: cada propiedad del frontmatter se convierte en una columna, con el tipo inferido (texto, número, checkbox, fecha, select, multi-select). También se pueden generar columnas explícitamente a partir de una nota plantilla ("Use note as template…").
- **Cuatro vistas**, cambiables desde pestañas: Tabla, Tablero (kanban con arrastrar y soltar), Lista y Galería.
- **Edición inline** de celdas, que escribe de vuelta al frontmatter del fichero `.md` correspondiente. Las celdas de tipo `filePath` son clicables y abren la nota en otra pestaña, respetando el editor configurado por defecto (p.ej. un editor WYSIWYG de otra extensión).
- **Wikilinks clicables**: cualquier campo de texto o de lista (multi-select/tags) que contenga sintaxis `[[nota]]`, `[[nota|alias]]` o `[[nota#encabezado]]` la muestra como enlace en lugar de texto literal; al hacer clic se busca la nota por nombre en toda la carpeta de trabajo (con selector si hay varias coincidencias) y se abre igual que un enlace de Obsidian.
- Gestión de columnas (añadir, renombrar, eliminar, reordenar arrastrando por el tirador ⋮⋮ del encabezado), **filtros con grupos anidados AND/OR**, y orden múltiple, por vista. **Eliminar una columna** pide confirmación y, al aceptar, borra también esa clave del frontmatter de todos los documentos actualmente mostrados en la base de datos (los resultantes del folder-scan o de la consulta) — no solo de la lista de propiedades, evitando que reaparezca sola en el siguiente refresco. Las columnas calculadas (`formula`, `createdTime`, `modifiedTime`, `filePath`) no tocan ningún documento al borrarse, porque nunca se guardan en el frontmatter.
- **Visibilidad de columnas de dos niveles**: el botón 👁/🚫 oculta/muestra una columna por defecto en cualquier vista que no la haya personalizado todavía; el checkbox junto a cada columna en el menú "Columns" la oculta/muestra **solo en la vista activa**, sin afectar a las demás — así una vista puede mostrar todos los campos y otra solo un subconjunto reordenado.
- **Hints en todos los botones**: cada botón de la barra de herramientas y sus menús tiene un tooltip explicando qué hace.
- **Columnas de fórmula**: motor de expresiones propio (sin `eval`) con funciones tipo `concat`, `if`, operadores aritméticos/lógicos, y acceso a otras propiedades de la fila.
- **Filas nuevas con frontmatter real**: se generan con un valor por defecto por columna (no un fichero en blanco). En bases de datos de tipo consulta, además se extraen (de forma heurística) las condiciones de igualdad simples del `WHERE` para que la fila nueva tenga más papeletas de cumplir la consulta desde el primer momento. Si se configura una **plantilla de fila** (`current_row_template`, solo en notas de base de datos), la nueva nota copia su frontmatter y cuerpo.
- **Placeholders interactivos en la plantilla de fila**: cualquier `<%etiqueta%>` en el frontmatter o el cuerpo de la plantilla se pregunta al usuario (uno por etiqueta distinta, en orden) antes de crear la nota; cancelar cualquier pregunta aborta la creación sin escribir archivo. El placeholder especial `<%date%>` / `<%date FORMATO%>` no se pregunta: se sustituye automáticamente por la fecha de hoy con los tokens `YYYY`/`YY`/`MM`/`DD` del formato indicado (p.ej. `<%date DD/MM/YYYY%>` → `26/08/2026`), o `YYYYMMDD` si no se indica formato.
- **Exportar/Importar CSV**: exporta las filas visibles de la vista activa; importa un CSV creando notas nuevas y añadiendo columnas que falten.
- **Diálogo ⚙ por base de datos**: nombre, descripción, ancho de celda, columna fija, y — en notas de base de datos — el origen de datos (carpeta o consulta, con su carpeta/query editable) y la plantilla de fila, sin tocar el YAML a mano. Los cambios sin guardar no se pierden si el ratón sale del panel sin querer, y una consulta inválida no se puede guardar: se valida contra `angelCastro.obsidianlike-dataview` y se muestra el error antes de permitir guardar. La validación es robusta también frente a una consulta con error de sintaxis (no solo semántico) y frente a la propia extensión de dataview: nunca escribe una consulta rota en la nota, aunque el diálogo se salte de alguna forma.
- **Ajustes de bóveda** (`Obsidian like DbFolder: Configure Vault Settings`): diálogo con los ajustes globales/compartidos, leídos y escritos directamente en `.obsidian/plugins/dbfolder/data.json` — el mismo fichero que usa el plugin real de Obsidian, para que ambos se mantengan sincronizados sobre la misma bóveda.
- Refresco en vivo: un file watcher detecta cambios externos en las notas y actualiza la vista.

## Modo consulta (`source_data: query`)

Las bases de datos con una consulta estilo Dataview (`FROM "..." WHERE ...`) delegan la resolución de filas en la extensión hermana **`angelCastro.obsidianlike-dataview`** (su API exportada). Si no está instalada/activa, se muestra un error claro en vez de fallar en silencio. Importante: el `WHERE` de la consulta **define qué notas existen** en la base de datos — el filtro de la propia tabla solo puede reducir ese conjunto, nunca ampliarlo. Una fila creada con **+ New** se sigue mostrando aunque el índice de la extensión hermana tarde un momento en detectar el archivo nuevo, hasta que la consulta la incluya por sí misma.

## Requisitos

- Una carpeta o nota Markdown con frontmatter YAML.
- Para bases de datos de tipo consulta: la extensión `angelCastro.obsidianlike-dataview` instalada y activa.

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

## Seguridad

Esta extensión **no realiza ninguna llamada de red saliente**. Auditado explícitamente:

- Sin `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` ni módulos `http`/`https`/`net` de Node, ni en el código fuente ni en el bundle compilado (`dist/extension.js`, `dist/webview.js`).
- Sin telemetría, analítica ni reporting de errores a servicios externos.
- El webview aplica una Content-Security-Policy sin ninguna excepción de red: `default-src 'none'`, con `img-src`/`style-src`/`script-src` restringidos a los recursos empaquetados dentro de la propia extensión (ningún `https:` permitido).
- Todas las dependencias de runtime (`gray-matter`, `js-yaml`, `react`, `react-dom`) resuelven desde el registro oficial de npm; ninguna es una librería de telemetría.
- `gray-matter` parsea el frontmatter YAML usando el loader **seguro** de `js-yaml` (`safeLoad`/`safeDump`); el bloque `yaml:dbfolder` propio se parsea con `js-yaml` v4, seguro por defecto (sin el esquema `!!js/function`).
