# No secret values are ever output.

output "load_balancer_dns_name" {
  description = "Public DNS name of the load balancer (point your domain's CNAME/alias here)."
  value       = module.alb.dns_name
}

output "autoscaling_group_name" {
  description = "Auto Scaling group running the SurgeGuard host."
  value       = module.compute.autoscaling_group_name
}

output "ssm_parameter_prefix" {
  description = "Parameter Store path the host reads its .env values from."
  value       = local.ssm_prefix
}

output "vpc_id" {
  description = "VPC id."
  value       = module.network.vpc_id
}
