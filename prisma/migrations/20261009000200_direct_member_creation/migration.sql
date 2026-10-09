-- Cadastro direto de funcionários pelo dono/administrador (substitui o convite por e-mail):
-- o usuário recebe uma senha provisória e é obrigado a trocá-la no primeiro login.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
