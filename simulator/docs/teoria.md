# Teoria: del Navier-Stokes al modelo reducido

## 1. Fluido en el tanque cilindrico (fundamento)

El flujo incompresible con superficie libre cumple Navier-Stokes:

    rho (dv/dt + v·grad v) = -grad p + mu laplacian(v) + rho g
    div v = 0            (continuidad)

con condicion de superficie libre (cinematica + presion constante) y
paredes rigidas. En el regimen lineal (amplitudes pequenas), el flujo
es irrotacional: v = grad(phi), y la presion resuelve una ecuacion de
Poisson (proyeccion de Helmholtz). Resolver esto por CFD (grid 3D,
VOF/SPH) es costoso; para control y monitoreo la industria usa el
**modelo mecanico equivalente** (Abramson, NASA SP-106, 1966; Dodge,
2000): cada modo de slosh se representa como un oscilador
masa-resorte-amortiguador, con parametros derivados analiticamente
del potencial.

## 2. Modos antisimetricos de un cilindro (lo que usa la simulacion)

Para un tanque cilindrico de radio R y nivel h, los primeros dos modos
antisimetricos (m = 1) tienen k1·R = 1.841 y k2·R = 5.331 (raices de
J1'(x) = 0):

    omega_n^2 = (k_n g) tanh(k_n h)
    m_s       = m_liq · 2 tanh(k_n h) / (h k_n ((k_n R)^2 - 1))

Modelo mecanico equivalente (masa-resorte-amortiguador; equivalencia
exacta con el pendulo linealizado, ver "Equivalent Mechanical Models
for Sloshing", arXiv:2511.10172):

    m_s x'' + c_s x' + k_s x = -m_s a(t)
    k_s = m_s omega_n^2        c_s = 2 zeta m_s omega_n
    =>  x'' = -omega_n^2 x - 2 zeta omega_n x' - a(t)

Cada modo resuelve DOS orientaciones azimutales (cos theta / sin theta),
asi la superficie libre es una forma 3D real:

    eta(r, theta, t) = sum_n J1(k_n r) (x_n(t) cos theta + y_n(t) sin theta)

`tank_model.py` integra el estado [h, (x,x',y,y')×2 modos, tubo1..3] con
RK4 clasico (dt = 0.02 s por defecto en TankConfig; validate.py usa
0.05 s para correr mas rapido). La frecuencia natural depende de h(t),
asi que el sistema es lentamente variable; RK4 lo absorbe sin problema.

**Autovalidacion**: un barrido FFT de la respuesta libre de cada modo
debe picar en omega_n/(2 pi). Resultado modo 0: 1.750 Hz medido vs
1.746 Hz analitico (error 0.23 %); validate imprime ambos modos.

## 3. Caudales (Navier-Stokes en tuberia, forma cerrada)

Robo / sifon (flujo laminar en manguera): **Poiseuille**

    q_robo = pi r^4 rho g h / (8 mu L)

Desalojo autorizado (orificio): **Torricelli** (Bernoulli + area)

    q_valvula = Cd Ao sqrt(2 g h)

Balance de masa del nivel:

    dh/dt = (q_in - q_motor - q_fuga - q_robo) / (pi R^2)

## 4. Mitigacion fisica del slosh

- **Tubos porosos** (stilling wells): filtro pasa-bajas mecanico de
  primer orden `dh_tubo/dt = (h - h_tubo)/tau`; la lectura del sensor
  sale del tubo, no de la superficie turbulenta. Es el mismo principio
  del focus tube del sistema FuelCheck de Carrier.
- **Anillos baffle** (capas circulares): amortiguamiento por arrastre
  de la ola contra el anillo. La literatura reporta hasta ~18x de
  damping ratio con 3-4 capas (IOP 2023). En el modelo entra como
  `zeta_baffle` aditivo; medido en simulacion: 11.6x de reduccion de
  amplitud con excitacion de banda ancha.
- **Votacion 2-de-3**: tres tubos en triangulo; desacuerdo > 15 mm
  indica turbulencia o falla de sensor (se filtra); acuerdo total con
  caida = evento global real.

## 5. Deteccion de cambio (CUSUM por bloques)

Residuo: `r(t) = h_filtrada - h_esperada`, donde `h_esperada` integra
el consumo modelado del motor (y se reinicia en recargas autorizadas).
Sobre el residuo se estima la pendiente en una ventana deslizante de
300 s y se actualiza el CUSUM tabular (Page, 1954) **una vez por
bloque de 60 s** (incrementos ~independientes):

    drift  = (media(r, 2da mitad) - media(r, 1ra mitad)) / (W/2)
    z      = drift / sigma_d(contexto)
    S_neg  = max(0, S_neg - z - k)        alarma si S_neg > h
    S_pos  = max(0, S_pos + z - k)        alarma si S_pos > h

`sigma_d` se calibra por contexto (parado / en movimiento) durante un
burn-in de 8 bloques y se congela: turbulencia en marcha = sigma
mayor = CUSUM mas silencioso (umbral adaptativo por contexto).

Reglas de contexto sobre el CUSUM:

| Condicion | Clasificacion |
|---|---|
| Subida sostenida + autorizacion RFID activa | recarga (silencio, modelo reinicia) |
| Caida sostenida + motor encendido | fuga (confianza por magnitud de z) |
| Tasa cruda < -2 L/min en 20 s + motor apagado + detenido + 3/3 sensores | extraccion (via rapida, ~9 s) |
| Caida puntual + en movimiento + desacuerdo de sensores | slosh (suprimido) |

## 6. Por que CUSUM y no umbral fijo

Un umbral fijo (como el de FuelCheck: apagado a 10 % por 60 s) detecta
el nivel, no la causa, y dispara con cada bache. CUSUM acumula la
evidencia de una deriva pequena y sostenida: es optimo en retraso de
deteccion para una tasa de falsas alarmas fija (*Window-Limited CUSUM*,
IEEE Trans. Inf. Theory 69(9), 2023), y el umbral h controla
directamente la tasa de falsas alarmas. El trade-off medido: fuga de
0.8 L/min en 60 s, de 0.1 L/min en 120 s, 0 falsas alarmas en 20 dias
simulados.

## 7. Supuestos y limites (honestidad)

- Modelo de orden reducido lineal (2 modos antisimetricos × 2
  orientaciones): valido para amplitudes pequenas-moderadas; no modela
  breaking waves ni swirl.
- El sim acelera el tiempo (speedup 20x) solo para la demo; todas las
  metricas corren a velocidad fisica.
- Los costos citados son de fuentes publicas (Shell, PEMEX, Canacar);
  el BOM es cotizacion commodity, no fabricacion.
