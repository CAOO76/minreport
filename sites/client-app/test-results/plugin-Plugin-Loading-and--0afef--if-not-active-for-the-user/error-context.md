# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - navigation [ref=e5]:
        - link "Home" [ref=e6] [cursor=pointer]:
          - /url: http://localhost:5179/
        - link "Solicitar Acceso" [ref=e7] [cursor=pointer]:
          - /url: /request-access
      - generic [ref=e8]:
        - link "login" [ref=e9] [cursor=pointer]:
          - /url: /login
          - generic [ref=e10] [cursor=pointer]: login
        - button "Cambiar tema" [ref=e11] [cursor=pointer]:
          - generic [ref=e12] [cursor=pointer]: dark_mode
    - main [ref=e13]:
      - generic [ref=e14]:
        - heading "Iniciar Sesión" [level=2] [ref=e15]
        - paragraph [ref=e16]: Bienvenido de nuevo. Ingresa tus credenciales para acceder a tu cuenta.
        - generic [ref=e17]:
          - generic [ref=e18]:
            - generic [ref=e19]: Correo Electrónico
            - textbox "Correo Electrónico" [ref=e20]
          - generic [ref=e21]:
            - generic [ref=e22]: Contraseña
            - generic [ref=e23]:
              - textbox "Contraseña" [ref=e24]
              - button "Mostrar contraseña" [ref=e25] [cursor=pointer]:
                - generic [ref=e26] [cursor=pointer]: visibility
          - link "¿Olvidaste tu contraseña?" [ref=e28] [cursor=pointer]:
            - /url: "#"
          - button "Iniciar Sesión" [ref=e29] [cursor=pointer]
  - paragraph [ref=e30]: Running in emulator mode. Do not use with production credentials.
```