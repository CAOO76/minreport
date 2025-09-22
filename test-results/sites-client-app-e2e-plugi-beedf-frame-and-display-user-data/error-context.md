# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - navigation [ref=e5]:
        - link "home" [ref=e6] [cursor=pointer]:
          - /url: http://localhost:5176
          - generic [ref=e7] [cursor=pointer]: home
        - link "Solicitar Acceso" [ref=e8] [cursor=pointer]:
          - /url: /request-access
      - generic [ref=e9]:
        - link "login" [ref=e10] [cursor=pointer]:
          - /url: /login
          - generic [ref=e11] [cursor=pointer]: login
        - button "Cambiar tema" [ref=e12] [cursor=pointer]:
          - generic [ref=e13] [cursor=pointer]: dark_mode
    - main [ref=e14]:
      - generic [ref=e15]:
        - heading "Iniciar Sesión" [level=2] [ref=e16]
        - paragraph [ref=e17]: Bienvenido de nuevo. Ingresa tus credenciales para acceder a tu cuenta.
        - generic [ref=e18]:
          - paragraph [ref=e19]: Credenciales inválidas o acceso no autorizado.
          - generic [ref=e20]:
            - generic [ref=e21]: Correo Electrónico
            - textbox "Correo Electrónico" [ref=e22]: test@example.com
          - generic [ref=e23]:
            - generic [ref=e24]: Contraseña
            - generic [ref=e25]:
              - textbox "Contraseña" [ref=e26]: password123
              - button "Mostrar contraseña" [ref=e27] [cursor=pointer]:
                - generic [ref=e28] [cursor=pointer]: visibility
          - link "¿Olvidaste tu contraseña?" [ref=e30] [cursor=pointer]:
            - /url: "#"
          - button "Iniciar Sesión" [ref=e31] [cursor=pointer]
  - paragraph [ref=e32]: Running in emulator mode. Do not use with production credentials.
```