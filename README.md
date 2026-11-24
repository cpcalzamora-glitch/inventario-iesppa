# Inventario IESPPA 2026

App web (PWA) para la verificación física y el etiquetado de los bienes patrimoniales del IESPP Azángaro, con corte al 31/12/2026. Está pensada para 2 o 3 celulares Android que trabajan a la vez, incluso sin señal.

Especificación vigente: **`PLAN_APP_INVENTARIO_IESPPA_v3.md`** (24/11/2026), que reemplaza a la v1 y a la v2.

- **Base de datos:** Google Sheet `BD_APP_INVENTARIO_IESPPA_2026`. Es privado y no se guarda en este repositorio.
- **Backend:** Google Apps Script publicado como Web App (`apps-script/`).
- **Frontend:** HTML, CSS y JavaScript sin compilación (`web/`), publicado en GitHub Pages.
- **Escáner:** Code 128 y QR con la cámara trasera (`web/vendor/html5-qrcode.min.js`). También acepta un lector Bluetooth en modo teclado o el código escrito a mano.
- **Constancias en PDF:** se generan en el celular con jsPDF y jsPDF-AutoTable (`web/vendor/`), a partir de lo verificado.

## Estructura

```
apps-script/   backend (Code.gs, auth.gs, data.gs, sync.gs, setup.gs, appsscript.json)
web/           la app que se publica (index.html, sw.js, manifest, js/, css/, vendor/, icons/, img/)
  js/constancia.js        constancia de verificación física por ambiente (PDF)
tools/
  unir-gs.js              une los .gs en un solo archivo para pegarlo en el editor de Apps Script
  crear-iconos.js         genera los íconos PNG
  servidor-prueba/        ejecuta el backend real en la PC con una copia de la base (solo pruebas)
.github/workflows/pages.yml   publica web/ en GitHub Pages
```

## Reglas de negocio implementadas

- **Etiqueta DEFINITIVA:** solo para bienes `12D`. Los bienes `8D`, `SIN` y las altas 2025 llevan etiqueta **TEMPORAL**. El servidor lo impone aunque la app enviara otra cosa.
- **Verificación por lote:** los `8D` y las altas se verifican contando, agrupados por denominación, marca, modelo, color y dimensiones. Si dos celulares cuentan el mismo grupo, el servidor reemplaza las filas repetidas por otras pendientes del mismo grupo, así que no se duplica nada.
- **Pendientes:** los bienes no encontrados quedan **PENDIENTE** y se tratan en un inventario aparte. En campo nunca se declara un faltante.
- **Sobrantes:** van solo a la hoja `SOBRANTES` (inventario aparte), con un código `S-001`, `S-002`… por unidad. El correlativo es global y se guarda en `CONFIG`.
- **Bienes del SIGA sin ubicar:** se confirman en el ambiente donde se encuentren.
- **Bien ya verificado en otro ambiente:** exige "Mover a este ambiente" y queda en el `HISTORIAL` como `MOVER`.
- **Escrituras:** usan `LockService` y un `op_id` (UUID) idempotente. Reenviar la cola no repite nada. Nunca se borran filas y todo cambio de campo va al `HISTORIAL`.
- **Códigos:** solo existen códigos de **8** o **12** dígitos (más las altas 2025 y los bienes sin código). Si se lee un código de otra longitud, la app avisa y no lo asume. `verificarEstructura()` lista los que haya en la base (hoy uno de 9 dígitos, id 239).
- **Situación (U/D):** al verificar, el inventariador elige Uso o Desuso (por defecto U). Se guarda en `BIENES.situacion` y sale en la constancia.
- **Dos informes:** el **informe DREP** trae solo los bienes de 12 dígitos (`destino_informe = DREP+INTERNO`); el **informe interno** trae **todos** los bienes (12 y 8 dígitos, altas 2025, sin código) más los sobrantes. `destino_informe` (columna AG) tiene valores fijos, ya no es fórmula. Las exportaciones se hacen en la Fase 2.
- **Constancia por ambiente:** al cerrar el ambiente la app genera la **constancia de verificación física** en PDF (A4 horizontal, tablas de 806 pt, encabezado, 3 firmas con sello) solo con lo verificado: bienes ubicados en el ambiente y sus sobrantes. El ambiente queda **CERRADO** recién cuando se marca la constancia como **FIRMADA**. Si después de imprimirla se verifica algo más en ese ambiente, la constancia vuelve a PENDIENTE y hay que generarla de nuevo. Nunca se generan por lote ni por adelantado.
- **Bienes referidos como entregados sin baja (2c):** si se escanea un bien marcado `REFERIDO_ENTREGADO_SIN_BAJA`, la app avisa; al confirmarlo se quita la marca (HISTORIAL `QUITAR_REFERIDO`) y se conserva la declaración. Los que no aparecen siguen PENDIENTE. La app solo documenta: no da de baja ni declara faltantes en campo.
- **Sesión:** usuario y PIN, con el PIN guardado como SHA-256 con sal. El token dura 7 días. Tras 5 intentos fallidos, el usuario queda bloqueado 10 minutos. Para bloquear a alguien, ponga `activo = NO` en `USUARIOS`.

## API

Una sola URL (`…/exec`). Se llama con `POST`, `Content-Type: text/plain` y el cuerpo `{"action": "...", "token": "...", ...}`. La respuesta tiene la forma `{ok, data}` o `{ok: false, error, codigo}`.

| Acción | Entrada | Salida |
|---|---|---|
| `login` | `usuario, pin` | `token, usuario, nombre, rol, vence` |
| `getBootstrap` | — | `bienes{columnas, filas}, ambientes, personal, config, listas, sobrantes, historial_n` |
| `getCambios` | `desde_n, ids?` | bienes tocados desde la fila N del HISTORIAL, ambientes, sobrantes |
| `sync` | `ops[]` | por cada op: `estado` (`ok`, `duplicada`, `conflicto` o `error`) y `data` |
| `abrirAmbiente` | `op_id, ambiente_id` | ambiente (EN_CURSO, constancia PENDIENTE) |
| `cerrarAmbiente` | `op_id, ambiente_id, ts` | la constancia queda IMPRESA con su fecha; devuelve `ubicados, pendientes[], sobrantes` |
| `firmarConstancia` | `op_id, ambiente_id, firmante` | constancia FIRMADA y ambiente CERRADO (solo si estaba IMPRESA) |
| `verificar` | `op_id, bien_id, ambiente_id, estado_conserv, situacion?, responsable?, mover?, version_cliente?, obs?` | `bien`, `aviso?` o `conflicto: YA_VERIFICADO` |
| `verificarLote` | `op_id, ambiente_id, bien_ids[], estado_conserv, situacion?` | `marcados[], reemplazos, sin_reemplazo` |
| `registrarSobrante` | `op_id, ambiente_id, denominacion, …, estado_conserv, cantidad` | `codigos[]` |
| `editarResponsableAmbiente` | `op_id, ambiente_id, responsable` | ambiente |

`GET ?action=ping` solo devuelve conteos, sin datos de bienes, para comprobar que el servicio está vivo.

## Desplegar el backend (Apps Script)

clasp no funciona con esta cuenta porque Google solo le concede los permisos de nombre y correo. Por eso el código se pega a mano:

1. En la PC, ejecute `node tools/unir-gs.js "<carpeta>\CODIGO_APPS_SCRIPT.txt"`. Esto genera un solo archivo con todo el backend.
2. En el Sheet, abra **Extensiones → Apps Script** y entre a `Código.gs`.
3. Seleccione todo con **Ctrl+A**, pegue el contenido nuevo y guarde con **Ctrl+S**.
4. La primera vez, entre a **⚙ Configuración del proyecto** y ponga la zona horaria en **(GMT-05:00) Lima**.
5. Ejecute `verificarEstructura` para revisar el resultado en el registro. Si el Sheet no tiene aún la estructura v3, use el menú **Inventario App → Actualizar estructura a la v3** (`migrarV3`): agrega al final las columnas nuevas y la hoja `DECLARACIONES`, sin mover ni borrar nada. Se puede ejecutar varias veces.
6. Entre a **Implementar → Gestionar implementaciones → ✏ (editar)**:
   - **Versión:** *Nueva versión*
   - **Ejecutar como:** *Yo*
   - **Quién tiene acceso:** **Cualquiera**
7. Pulse **Implementar**. La URL `/exec` no cambia.

Los PIN se asignan en el Sheet, desde el menú **Inventario App → Asignar PIN a un usuario**.

## Publicar la web (GitHub Pages)

1. Suba el repositorio a GitHub. Debe ser público para usar GitHub Pages gratis. Los datos no están en el repositorio.
2. En GitHub, entre a **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada `git push` a `main` publica `web/` en **https://cpcalzamora-glitch.github.io/inventario-iesppa/** (repositorio `cpcalzamora-glitch/inventario-iesppa`).
4. **Al publicar cambios en la web**, suba la constante `VERSION` de `web/sw.js`. Así los celulares descargan la versión nueva.

## Instalar en el celular

1. En Chrome para Android, abra la dirección de GitHub Pages.
2. Ingrese con su usuario y PIN. La primera vez se descarga la base, de unos 700 KB.
3. Abra el menú **⋮** de Chrome y elija **Agregar a pantalla principal** (o **Instalar app**).
4. La primera vez que pulse **Escanear**, permita el uso de la cámara.

## Uso en campo

1. **Ambientes:** toque un ambiente para abrirlo. Queda como ambiente activo y todo lo que se verifique toma ese ambiente y su responsable.
2. **Con código:** pulse **Escanear** para trabajar en ráfaga: lee el código, muestra la ficha, se elige el estado, se pulsa **Confirmar** y la cámara sigue leyendo sola. Etiqueta **DEFINITIVA**.
3. **Por lote y Altas 2025:**
   1. Cuente los bienes iguales con **+/−**, o pulse **Todas**.
   2. Elija el estado y pulse **Confirmar**.
   3. Etiqueta **TEMPORAL**, con la referencia que muestra la app (el código interno).
   4. Si cuenta más de las esperadas, la app ofrece registrarlas como sobrante.
4. **Sobrantes:** use el botón **+ Sobrante**. El código `S-xxx` aparece al sincronizar.
5. **Cerrar ambiente:**
   1. Muestra cuántos bienes están ubicados, cuántos pendientes y cuántos sobrantes. Los pendientes no pasan a faltantes.
   2. **Generar constancia** descarga el PDF. Necesita que los sobrantes ya tengan su código S-xxx (sincronizados) y que el ambiente tenga responsable.
   3. Imprímala, hágala firmar y sellar. Luego pulse **Marcar FIRMADA**: recién ahí el ambiente queda CERRADO. Mientras tanto el ambiente muestra "Constancia impresa · falta la firma" y el botón **PDF** para volver a descargarla.
6. **Barra superior:**
   - Muestra si hay conexión y cuántos pendientes quedan por sincronizar. Sin señal se sigue trabajando y todo se envía solo.
   - El ⚠ muestra los avisos, por ejemplo un bien que otro celular ya ubicó en otro ambiente.

## Pruebas en la PC

```bash
cd tools/servidor-prueba
npm install
node prueba-fase0.js "<ruta>\BD_APP_INVENTARIO_IESPPA_2026.xlsx"
node prueba-fase1.js "<ruta>\BD_APP_INVENTARIO_IESPPA_2026.xlsx"
node prueba-v3-estructura.js "<ruta>\BD_APP_INVENTARIO_IESPPA_2026.xlsx"
node prueba-constancia.mjs "<ruta>\BD_APP_INVENTARIO_IESPPA_2026.xlsx" constancia.pdf
```

Qué cubren respecto del punto 10 del plan:

| Prueba del plan | Dónde |
|---|---|
| 2. Concurrencia (2 o 3 usuarios) | `prueba-fase1.js` (dos usuarios a la vez, lotes simultáneos) |
| 3. Código duplicado e inexistente | app en la PC (`servidor.js`); longitud no válida: aviso propio |
| 4. Recorrido sin conexión | app en la PC con la red cortada |
| 6. Informe DREP solo 12 dígitos; interno = BIENES + sobrantes; flujo 2c con 2 bienes | `prueba-fase1.js`, `prueba-v3-estructura.js` |
| Constancia: tablas de 806 pt, solo lo verificado, fecha y DNI | `prueba-constancia.mjs` |
| 1. Etiquetas Zebra con poca luz a 20 cm, 7. piloto Aula 102 y 202 | en campo, con los celulares |
| 5. Exportación Excel vs. ficha impresa | Fase 2 |

Para probar la app completa en la PC, inicie el servidor con PIN de prueba y abra `http://localhost:8080`:

```bash
PINES_PRUEBA="hernan:9101,invent1:9102,invent2:9103" REINICIAR=1 node servidor.js "<ruta>\BD_APP_INVENTARIO_IESPPA_2026.xlsx"
```

El servidor trabaja sobre una **copia** de la base (`tools/servidor-prueba/datos/`). La base original no se toca.
